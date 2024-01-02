import {
  ClassDeclaration,
  ConstructorDeclaration,
  Expression,
  FunctionDeclaration,
  Node,
  ObjectLiteralExpression,
  Project,
  Scope,
  StructureKind,
} from 'ts-morph';

const SCRIPT_TAG_REGEX = /<script lang="ts">([\s\S]*?)<\/script>/i;
const TEMPLATE_TAG_REGEX = /<template>([\s\S]*?)<\/template>/i;
const STYLE_TAG_REGEX = /<style>([\s\S]*?)<\/style>/i;

const ON_INIT = 'onInit';

export function processNgFile(
  fileName: string,
  content: string,
  isProd = false
) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { names } = require('@nx/devkit');

  const componentName = fileName.split('/').pop()?.split('.')[0];
  if (!componentName) {
    throw new Error(`[Analog] Missing component name ${fileName}`);
  }

  const {
    fileName: componentFileName,
    className,
    constantName,
  } = names(componentName);

  // eslint-disable-next-line prefer-const
  let [scriptContent, templateContent, styleContent] = [
    SCRIPT_TAG_REGEX.exec(content)?.pop()?.trim() || '',
    TEMPLATE_TAG_REGEX.exec(content)?.pop()?.trim() || '',
    STYLE_TAG_REGEX.exec(content)?.pop()?.trim() || '',
  ];

  if (!scriptContent && !templateContent) {
    throw new Error(
      `[Analog] Either <script> or <template> must exist in ${fileName}`
    );
  }

  const ngType = templateContent ? 'Component' : 'Directive';

  if (styleContent) {
    templateContent = `<style>${styleContent.replace(/\n/g, '')}</style>
${templateContent}`;
  }

  const source = `
import { ${ngType}${
    ngType === 'Component' ? ', ChangeDetectionStrategy' : ''
  } } from '@angular/core';

@${ngType}({
  standalone: true,
  selector: '${componentFileName},${className},${constantName}',
  ${
    ngType === 'Component'
      ? `changeDetection: ChangeDetectionStrategy.OnPush,
      template: \`${templateContent}\``
      : ''
  }
})
export default class AnalogNgEntity {
  constructor() {}
}`;

  // the `.ng` file
  if (scriptContent) {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(fileName, scriptContent);
    project.createSourceFile(`${fileName}.virtual.ts`, source);

    return processNgScript(fileName, project, ngType, isProd);
  }

  return source;
}

function processNgScript(
  fileName: string,
  project: Project,
  ngType: 'Component' | 'Directive',
  isProd?: boolean
) {
  const ngSourceFile = project.getSourceFile(fileName);
  const targetSourceFile = project.getSourceFile(`${fileName}.virtual.ts`);

  if (!ngSourceFile || !targetSourceFile) {
    throw new Error(`[Analog] Missing source files ${fileName}`);
  }

  const targetClass = targetSourceFile.getClass(
    (classDeclaration) => classDeclaration.getName() === 'AnalogNgEntity'
  );

  if (!targetClass) {
    throw new Error(`[Analog] Missing class ${fileName}`);
  }

  const targetMetadata = targetClass.getDecorator(ngType);

  if (!targetMetadata) {
    throw new Error(`[Analog] Missing metadata ${fileName}`);
  }

  const targetMetadataArguments =
    targetMetadata.getArguments()[0] as ObjectLiteralExpression;

  if (!Node.isObjectLiteralExpression(targetMetadataArguments)) {
    throw new Error(`[Analog] invalid metadata arguments ${fileName}`);
  }

  const targetConstructor = targetClass.getConstructors()[0];
  const targetConstructorBody = targetConstructor.getBody();

  if (!Node.isBlock(targetConstructorBody)) {
    throw new Error(`[Analog] invalid constructor body ${fileName}`);
  }

  const declarations: string[] = [];

  ngSourceFile.forEachChild((node) => {
    // for ImportDeclaration (e.g: import ... from ...)
    if (Node.isImportDeclaration(node)) {
      const moduleSpecifier = node.getModuleSpecifierValue();
      if (moduleSpecifier.endsWith('.ng')) {
        // other .ng files
        declarations.push(node.getDefaultImport()?.getText() || '');
      }

      // copy the import to the target `.ng.ts` file
      targetSourceFile.addImportDeclaration(node.getStructure());
    }

    // for VariableStatement (e.g: const ... = ...)
    if (Node.isVariableStatement(node)) {
      const declarations = node.getDeclarations();
      const declaration = declarations[0];
      const initializer = declaration.getInitializer();

      if (initializer) {
        addPropertyToClass(
          targetClass,
          targetConstructor,
          declaration.getName(),
          initializer,
          (propertyName, propertyInitializer) => {
            targetConstructor.addVariableStatement({
              declarations: [
                {
                  name: propertyName,
                  initializer: propertyInitializer.getText(),
                  type: declaration.getTypeNode()?.getText(),
                },
              ],
            });
          }
        );
      }
    }

    if (Node.isFunctionDeclaration(node)) {
      addPropertyToClass(
        targetClass,
        targetConstructor,
        node.getName() || '',
        node,
        (propertyName, propertyInitializer) => {
          targetConstructor.addFunction({
            name: propertyName,
            parameters: propertyInitializer
              .getParameters()
              .map((parameter) => parameter.getStructure()),
            statements: propertyInitializer
              .getStatements()
              .map((statement) => statement.getText()),
          });
        }
      );
    }

    if (Node.isExpressionStatement(node)) {
      const expression = node.getExpression();
      if (Node.isCallExpression(expression)) {
        // hooks, effects, basically Function calls
        const functionName = expression.getExpression().getText();
        if (functionName === 'defineMetadata') {
          const metadata =
            expression.getArguments()[0] as ObjectLiteralExpression;
          processMetadata(metadata, targetMetadataArguments, targetClass);
        } else if (functionName === ON_INIT) {
          const initFunction = expression.getArguments()[0];
          if (Node.isArrowFunction(initFunction)) {
            addPropertyToClass(
              targetClass,
              targetConstructor,
              ON_INIT,
              initFunction,
              (propertyName, propertyInitializer) => {
                targetConstructor.addFunction({
                  name: propertyName,
                  statements: propertyInitializer
                    .getStatements()
                    .map((statement) => statement.getText()),
                });

                targetClass.addMethod({
                  name: 'ngOnInit',
                  statements: `this.${propertyName}();`,
                });
              }
            );
          }
        } else {
          targetConstructor.addStatements(node.getText());
        }
      }
    }
  });

  if (ngType === 'Component') {
    const importsMetadata = targetMetadataArguments.getProperty('imports');
    if (importsMetadata && Node.isPropertyAssignment(importsMetadata)) {
      const importsInitializer = importsMetadata.getInitializer();
      if (Node.isArrayLiteralExpression(importsInitializer)) {
        importsInitializer.addElement(declarations.filter(Boolean).join(', '));
      }
    } else {
      targetMetadataArguments.addPropertyAssignment({
        name: 'imports',
        initializer: `[${declarations.filter(Boolean).join(', ')}]`,
      });
    }
  }

  if (!isProd) {
    // PROD probably does not need this
    targetSourceFile.formatText({ ensureNewLineAtEndOfFile: true });
  }

  return targetSourceFile.getText();
}

function processMetadata(
  metadataObject: ObjectLiteralExpression,
  targetMetadataArguments: ObjectLiteralExpression,
  targetClass: ClassDeclaration
) {
  metadataObject.getPropertiesWithComments().forEach((property) => {
    if (Node.isPropertyAssignment(property)) {
      const propertyName = property.getName();
      const propertyInitializer = property.getInitializer();

      if (propertyInitializer) {
        if (propertyName === 'selector') {
          // remove the existing selector
          targetMetadataArguments.getProperty('selector')?.remove();
          // add the new selector
          targetMetadataArguments.addPropertyAssignment({
            name: 'selector',
            initializer: propertyInitializer.getText(),
          });
        } else if (propertyName === 'exposes') {
          // for exposes we're going to add the property to the class so they are accessible on the template
          // parse the initializer to get the item in the exposes array
          const exposes = propertyInitializer
            .getText()
            .replace(/[[\]]/g, '')
            .split(',')
            .map((item) => item.trim());

          for (const exposed of exposes) {
            targetClass.addProperty({
              name: exposed,
              initializer: exposed,
              kind: StructureKind.Property,
              scope: Scope.Protected,
            });
          }
        } else {
          targetMetadataArguments.addPropertyAssignment({
            name: propertyName,
            initializer: propertyInitializer.getText(),
          });
        }
      }
    }
  });
}

function addPropertyToClass<
  TInitializer extends Expression | FunctionDeclaration
>(
  targetClass: ClassDeclaration,
  targetConstructor: ConstructorDeclaration,
  propertyName: string,
  propertyInitializer: TInitializer,
  constructorUpdater: (
    propertyName: string,
    propertyInitializer: TInitializer
  ) => void
) {
  // add the empty property the class (e.g: protected propertyName;)
  targetClass.addProperty({
    name: propertyName,
    kind: StructureKind.Property,
    scope: Scope.Protected,
  });

  // update the constructor
  constructorUpdater(propertyName, propertyInitializer);

  // assign the variable to the property
  targetConstructor.addStatements(
    Node.isArrowFunction(propertyInitializer) ||
      Node.isFunctionDeclaration(propertyInitializer)
      ? `this.${propertyName} = ${propertyName}.bind(this);`
      : `this.${propertyName} = ${propertyName};`
  );
}
