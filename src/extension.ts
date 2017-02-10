'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "openui5-require" is now active!');

    let requirer = new UI5Requirer();

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('ui5requirer.scanCurrent', () => {
        // The code you place here will be executed every time your command is executed

        // Display a message box to the user
        // vscode.window.showInformationMessage('Hello World!');

        requirer.scanCurrent();
    });


    context.subscriptions.push(disposable);
    context.subscriptions.push(requirer);
}

// this method is called when your extension is deactivated
export function deactivate() {
}

// -- Private functions ---------------------------------
function toGlob( p: string[] ): string {
    return p.length == 1 ? p[0] : ( "{"+p.join(",")+"}");
}


// -- Class definitions ----------------------------------
class UI5Requirer {

    // scanCurrent command
    // on the current file, what needs to happen:
    // 1. check if there is sap.ui.define([], function() { })
    // 2. check existing usage of libs (find all "sap.m.", "sap.ui.unified.") then add all into the sap.ui.define()
    scanCurrent() {
        let editor = vscode.window.activeTextEditor;

        if ( !editor ) {
            return;
        }

        // get configuration settings
        const config = vscode.workspace.getConfiguration("ui5requirer");
        const aLibraries = config.get<[string]>("libraries");
        const aExcluded = config.get<[string]>("excluded");

        let doc = editor.document;
        let currentDoc = doc.getText();
        let currentDocNoCmts = currentDoc.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1'); // @source: http://upshots.org/javascript/javascript-regexp-to-remove-comments
        let edit = new vscode.WorkspaceEdit();
        let reRequire = /sap\.ui\.define\s*\(\s*\[([^\]]*)\]\s*,\s*function\s*\(([^\)]*)\)([^\n]+)/m;
        let reToAdd = new RegExp("((new|instanceof)?\\s+['\"\{]?" + aLibraries.map((str) => str.replace(/\./g, "\\.") ).join("[\\w\.]+['\"\}]?|(new|instanceof)?\\s+['\"\{]?") + "[\\w\.]+['\"\}]?)", "g");

        let match = reRequire.exec(currentDoc);
        let toAddMatch = currentDocNoCmts.match(reToAdd);
        let aToAdd = [];
        if ( !match ) {
            vscode.window.showErrorMessage("There is no sap.ui.define([], function(){}) declaration on the current file. ");
            return;
        }
        if ( !toAddMatch ) {
            vscode.window.showInformationMessage("There is no code usage for the following libraries: " + aLibraries.join(", "));
            return;
        }

        let sClassDef = match[1];
        let sFunctionDef = match[2];
        let sSuffix = match[3];

        let aClassDef = sClassDef ? sClassDef.replace(/\/\/[^\n]*/gm, "").replace(/\/\*[\s\S]*?\*\//gm, "").replace(/[\s\n'"]+/g, " ").split(",").map((str) => str.trim() ).filter((str) => str.length ) : [];
        let aFunctionDef = sFunctionDef ? sFunctionDef.replace(/[\s\n]+/g, " ").replace(/\/\*[\s\S]*?\*\//gm, "").split(",").map((str) => str.trim() ).filter((str) => str.length ) : [];


        for(let a = 0; a < toAddMatch.length; a++) {

            let sToAddClass = toAddMatch[a].trim();

            // check if it's a reference to the control in string format, then skip (eg: items: { type: "sap.ui.core.Control" } )
            if ( sToAddClass.match(/['"\{\}]+/) ) {
                continue;
            }

            // check if we need to include extra chars after the class name (eg. sap.ui.core. => sap.ui.core.mvc but must be sap.ui.core.mvc.JSView);
            // note that we need to consider that the class' static function is called,
            // so we need to check if it's being instantiated as a class ('new Class()')
            // or used as parameter to instanceof
            let matchIsNewClass = sToAddClass.match(/^new\s*|instanceof\s*/);
            if ( matchIsNewClass ) {
                sToAddClass = sToAddClass.replace(matchIsNewClass[0], "");

                if ( aExcluded.indexOf(sToAddClass) != -1 )
                    continue;

            } else {

                if ( aExcluded.indexOf(sToAddClass) != -1 )
                    continue;

                // if a call to a static function, then the class name is the 2nd to the last
                // word between dots (IconPool in "sap.ui.core.IconPool.getIconURI()" )
                sToAddClass = sToAddClass.replace(/(.*\.\w+)\.\w+$/, "$1");

                if ( aExcluded.indexOf(sToAddClass) != -1 )
                    continue;
            }

            sToAddClass = sToAddClass.replace(/\./g, "/");
            // if ( aClassDef.indexOf(sToAddClass) == -1 && aToAdd.indexOf(sToAddClass) == -1 ) {
            if ( aToAdd.indexOf(sToAddClass) == -1 ) {
                aToAdd.push(sToAddClass);
                console.log("match:", sToAddClass);
            }

        }

        // if there are any classes to add, then rebuild the sap.ui.define() code
        if ( aToAdd.length ) {
            let posDefine = doc.positionAt( currentDoc.indexOf(match[0]) );
            let newLinesMatch = match[0].match(/\n/g);
            let numNewLines = newLinesMatch ? newLinesMatch.length : 0;
            let lastLineMatch = match[0].match(/\n([^\n]+)$/);
            let lastLineLen = lastLineMatch ? lastLineMatch[1].length : match[0].length;

            // exclude classes that are already defined
            let aFiltered = aToAdd.filter((str) => aClassDef.indexOf(str) == -1 )
            if ( aFiltered.length ) {

                aClassDef = aClassDef.concat(aFiltered);
                aFunctionDef = aFunctionDef.concat(aFiltered.map((str) => str.replace(/[\w\/]+\//, "") ));

                // add the classes in the sap.ui.define declaration
                edit.replace(
                    doc.uri,
                    new vscode.Range(posDefine.line, posDefine.character, posDefine.line + numNewLines, lastLineLen),
                    "sap.ui.define([\n    \"" + aClassDef.join("\", \"") + "\"\n], function( " + aFunctionDef.join(", ") + " )" + sSuffix
                );

                console.log("rebuilding sap.ui.define");
            }

            // update the way the classes are used
            let aRanges = [];
            for(let u in aToAdd) {
                var sClassName = aToAdd[u].replace(/\//g, ".");
                let lastIndex = currentDoc.indexOf(sClassName);

                // make sure it's not similar class names (sap.m.List and sap.m.ListBase)
                while ( lastIndex != -1 && currentDoc.substr(lastIndex + sClassName.length, 1).match(/\w/) ) {
                    lastIndex = currentDoc.indexOf(sClassName, lastIndex+1);
                }

                while(lastIndex > -1) {
                    let posClassName = doc.positionAt(lastIndex);

                    aRanges.push({
                        line: posClassName.line,
                        char: posClassName.character,
                        lastLine: posClassName.line,
                        lastChar: posClassName.character + sClassName.length,
                        className: sClassName
                    });

                    edit.replace(
                        doc.uri,
                        new vscode.Range(posClassName.line, posClassName.character, posClassName.line, posClassName.character + sClassName.length),
                        sClassName.replace(/[\w\.]+\./, "")
                    );
                    // console.log("replacing ", sClassName, " - ", lastIndex);

                    lastIndex = currentDoc.indexOf(sClassName, lastIndex+1);

                    // make sure it's not similar class names (sap.m.List and sap.m.ListBase)
                    while ( lastIndex != -1 && currentDoc.substr(lastIndex + sClassName.length, 1).match(/\w/) ) {
                        lastIndex = currentDoc.indexOf(sClassName, lastIndex+1);
                    }

                }
            }

            console.log("done");

            vscode.workspace.applyEdit(edit).then((value) => {
                console.log("success: ", value);

                vscode.window.showInformationMessage("Added " + aToAdd.length + " classes to sap.ui.define");
            }, (reason) => {
                console.log("fail: ", reason);

                vscode.window.showErrorMessage("Updating file failed: " + reason);
            });
        } else {

            console.log("No match found");
            vscode.window.showInformationMessage("No match found");

        }



    }


    dispose() {

    }
}