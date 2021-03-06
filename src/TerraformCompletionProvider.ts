import { CompletionItemProvider, TextDocument, Position, CancellationToken, CompletionItem, CompletionItemKind } from "vscode";
var resources = require('../../aws-resources.json');
import * as _ from "lodash";
import { TerraformApi } from "./TerraformApi";

const topLevelTypes = ["output", "provider", "resource", "variable", "data"];
var topLevelRegexes = topLevelTypes.map(o => {
    return {
        type: o,
        regex: new RegExp(o + ' "[A-Za-z0-9\-_]+" "[A-Za-z0-9\-_]*" \{')
    };
});

var topLevelModuleRegex = {
    type: "module",
    regex: new RegExp('module "[A-Za-z0-9\-_]+" \{')
};

var moduleInfoRegex = [
    {
        type: "source",
        regex: /\s*source\s*=\s*"([A-Za-z0-9\/\-_\.]+)"/
    },
    {
        type: "version",
        regex: /\s*version\s*=\s*"([A-Za-z0-9\/\-_.]+)"/
    },
]

export class TerraformCompletionProvider implements CompletionItemProvider {
    document: TextDocument;
    position: Position;
    token: CancellationToken;

    public provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): CompletionItem[] {
        console.log("provideCompletionItems called. Entry point!")
        this.document = document;
        this.position = position;
        this.token = token;
        
        console.log("position:")
        console.log(position)

        // Check if we're on the top level
        let lineText = document.lineAt(position.line).text;
        let lineTillCurrentPosition = lineText.substr(0, position.character);

        // Are we trying to type a resource type?
        if (this.isTopLevelType(lineTillCurrentPosition)) {
            return this.getTopLevelType(lineTillCurrentPosition);
        }

        // Are we trying to type a variable?
        if (this.isTypingVariable(lineTillCurrentPosition)) {
            console.log("isTypingVariable == true")
            // These variables should always just have 3 parts, resource type, resource name, exported field
            var varString = this.getVariableString(lineTillCurrentPosition);
            console.log("varString:")
            console.log(varString)
            var parts = varString.split(".");
            console.log(parts)

            if (parts.length == 1) {
                // We're trying to type the resource type
                console.log("Parts length == 1, Typing a resource type.")
                var resourceTypePrefix = parts[1];

                // Get a list of all the resource types we've defined in this file
                var definedResourceTypes = this.getDefinedResourceTypes(document);
                var finalResourceTypes = _.filter(definedResourceTypes, o => (o.indexOf(resourceTypePrefix) == 0));
                return _.map(finalResourceTypes, o => {
                    return new CompletionItem(o, CompletionItemKind.Field);
                });
            }
            else if (parts.length == 2) {
                // We're trying to type the resource name
                console.log("Parts length == 2, Typing a resource name.")
                var resourceType = parts[0];

                // Get a list of all the names for this resource type
                var names = this.getNamesForResourceType(document, resourceType);
                return _.map(names, o => new CompletionItem(o, CompletionItemKind.Field));
            }
            else if (parts.length == 3) {
                // We're trying to type the exported field for the resource or module
                console.log("Parts length == 3, Finding field export from resource.")
                let resourceType = parts[0];
                let resourceName = parts[1];
                if (resourceType === "resource") {
                    var attrs = resources[resourceType].attrs;
                } else if (resourceType === "module") {
                    let moduleData = this.getModuleSourceAndVersionFromName(document, resourceName);
                    return this.getOutputsForModule(moduleData.source, moduleData.version);
                }
                var result = _.map(attrs, o => {
                    let c = new CompletionItem(`${o.name} (${resourceType})`, CompletionItemKind.Property);
                    c.detail = o.description;
                    c.insertText = o.name;
                    return c;
                });
                return result;
            }

            // Which part are we completing for?
            return [];
        }

        // Are we trying to type a parameter to a resource?
        let possibleResources = this.checkTopLevelResource(lineTillCurrentPosition);
        if (possibleResources.length > 0) {
            console.log("Getting hints for resource")
            return this.getHintsForStrings(possibleResources);
        }

        // Check if we're in a resource or module definition
        console.log("Entering for section")
        let source = []
        let sourceFound: boolean = false
        for (var i = position.line - 1; i >= 0; i--) {
            let line = document.lineAt(i).text;
            let parentType = this.getParentType(line);
            console.log(`parentType: ${parentType}`);

            if (parentType && parentType.type == "resource") {
                // May have been replaced by Terraform Language server
                console.log("We're in resource type!")
                let resourceType = this.getResourceTypeFromLine(line);
                return []
                //return this.getItemsForArgs(resources[resourceType].args, resourceType);           
            }  else if (parentType && parentType.type == "module") {
                console.log("We're in a module!")
                let moduleData = this.getModuleSourceAndVersion();
                if (moduleData.source) {
                    return this.getItemsForModule(moduleData.source, moduleData.version);
                }   
            } else if (parentType && parentType.type != "resource") {
                console.log("We're not in a resource type!")
                // We don't want to accidentally include some other containers stuff
                return [];
            }
        }

        return [];
    }

    getNamesForResourceType(document: TextDocument, resourceType: string): string[] {
        console.log(`getNamesForResourceType: ${resourceType}`);
        var r = new RegExp('resource "' + resourceType +'" "([a-zA-Z0-9\-_]+)"');
        var found = [];
        for (var i = 0; i < document.lineCount; i++) {
            var line = document.lineAt(i).text;
            var result = line.match(r);
            if (result && result.length > 1) {
                found.push(result[1]);
            }
        }
        return _.uniq(found);
    }

    /**
     * Returns a list of resource type strings in the current document
     */
    getDefinedResourceTypes(document: TextDocument) {
        console.log(`getDefinedResourceTypes:`);
        var r = /resource "([a-zA-Z0-9\-_]+)"/;
        var found = [];
        for (var i = 0; i < document.lineCount; i++) {
            var line = document.lineAt(i).text;
            var result = line.match(r);
            if (result && result.length > 1) {
                found.push(result[1]);
            }
        }
        return _.uniq(found);
    }

    isTopLevelType(line: string): boolean {
        console.log(`isTopLevelType: ${line}`);
        for (var i=0; i<topLevelTypes.length; i++) {
            var resourceType = topLevelTypes[i];
            if (resourceType.indexOf(line) == 0) {
                return true;
            }
        }
        return false;
    }

    getTopLevelType(line: string): CompletionItem[] {
        console.log(`getTopLevelType: ${line}`);
        for (var i=0; i<topLevelTypes.length; i++) {
            var resourceType = topLevelTypes[i];
            if (resourceType.indexOf(line) == 0) {
                return [new CompletionItem(resourceType, CompletionItemKind.Enum)];
            }
        }
        return [];
    }

    isTypingVariable(line: string): boolean {
        console.log(`isTypingVariable: ${line}`);
        let tf11Regex = /\$\{[0-9a-zA-Z_\.\-]*$/;
        let tf12Regex = /=\s*([0-9a-zA-Z_\.\-])/;
        let varRegex = /(resource|module)\./
        return varRegex.test(line);
    }

    getVariableString(line: string): string {
        console.log(`getVariableString: ${line}`);
        let tf11Regex = /\$\{([0-9a-zA-Z_\.\-]*)$/;
        let tf12Regex = /([0-9a-zA-Z_\.\-]*)$/;
        let result = line.match(tf12Regex);
        console.log(result)
        if (result.length > 1) {
            return result[1];
        }
        return "";
    }

    checkTopLevelResource(lineTillCurrentPosition: string): any[] {
        console.log(`checkTopLevelResource: ${lineTillCurrentPosition}`);
        let parts = lineTillCurrentPosition.split(" ");
        if (parts.length == 2 && parts[0] == "resource") {
            let r = parts[1].replace(/"/g, '');
            let regex = new RegExp("^" + r);
            var possibleResources = _.filter(_.keys(resources), k => {
                if (regex.test(k)) {
                    return true;
                }
            });
            console.log(`Got possible resource:`)
            console.log(possibleResources)
            return possibleResources;
        }
        console.log("Found nothing")
        return [];
    }

    getHintsForStrings(strings: string[]): CompletionItem[] {
        console.log(`getHintsForStrings: ${strings}`);
        return _.map(strings, s => {
            return new CompletionItem(s, CompletionItemKind.Enum);
        });
    }


    /**
     * Finds the module source and version working backwards from the current
     * cursor position. Returns immediately after either finding both the source and version
     * or the module definition
     */
    getModuleSourceAndVersion(): any {
        // Checking module source
        let moduleData = {
            source: "",
            version: ""
        }

        for (var i = this.position.line - 1; i >= 0; i--) {
            let line = this.document.lineAt(i).text;

            // If we reach the line defining the module
            if (topLevelModuleRegex.regex.test(line)) {
                console.log("Reached very top of module. Bailing!");
                break;
            }

            for (let obj of moduleInfoRegex) {
                if (obj.regex.test(line)) {
                    console.log("Successfully found type: ");
                    console.log(obj.type);
                    moduleData[obj.type] = obj.regex.exec(line)[1];
                }
            }
            
            // Don't parse any further when we have our source and version
            if (moduleData["source"] !== "" && moduleData["version"] !== "") {
                console.log("Got our source and version! Bailing!");
                console.log(moduleData);
                break;
            }
        }
        
        console.log(moduleData)
        return moduleData;
    }

    /**
     * Finds the module source and version working forward when we find the line with the
     * provided moduleName. Ends when we reach a newline with only '}'.
     */
    getModuleSourceAndVersionFromName(document: TextDocument, moduleName: string) {
        console.log(`getModuleSourceAndVersionFromName:`);
        let r = RegExp("^module \"" +  moduleName + "\"")
        let moduleFound = false;
        let moduleData = {
            source: "",
            version: ""
        }
        console.log("Scanning document..")
        for (let i = 0; i < document.lineCount; i++) {
            var line = document.lineAt(i).text;
            console.log(line)

            var result = line.match(r);
            if (result) {
                console.log("Found module by name!")
                moduleFound = true;
            }

            if (moduleFound) {
                for (let obj of moduleInfoRegex) {
                    if (obj.regex.test(line)) {
                        console.log(`Successfully found type: ${obj.type}`);
                        moduleData[obj.type] = obj.regex.exec(line)[1];
                    }
                }
                
                // Don't parse any further when we have our source and version
                if (moduleData["source"] !== "" && moduleData["version"] !== "") {
                    console.log("Got our source and version! Bailing!");
                    console.log(moduleData);
                    break;
                }
            }

            if (moduleFound && line.match(/^}$/)) {
                console.log("module end found, could not determine module source");
                break;
            }
        }
        return moduleData;
    }

    getParentType(line: string): boolean|any {
        console.log(`getParentType: ${line}`);
        //console.log(topLevelRegexes)
        for (var i = 0; i < topLevelRegexes.length; i++) {
            let tl = topLevelRegexes[i];
            if (tl.regex.test(line)) {
                console.log("Successfully found type: ")
                console.log(tl)
                return tl;
            }
        }
        // Checking for modules
        if (topLevelModuleRegex.regex.test(line)) {
            console.log("Successfully found type: ")
            console.log(topLevelModuleRegex.type)
            return topLevelModuleRegex;
        }

        return false;
    }

    getResourceTypeFromLine(line: string): string {
        console.log(`gotResourceTypeFromLine: ${line}`);
        var lineParts = line.split(" ");
        var type = lineParts[1];
        return type.replace(/"/g, '');
    }

    getItemsForArgs(args, type) {
        console.log(`getItemsForArgs:`);
        console.log(args);
        console.log(type);
        return _.map(args, o => {
            let c = new CompletionItem(`${o.name} (${type})`, CompletionItemKind.Property);
            c.detail = o.description;
            c.insertText = o.name;
            return c;
        });
    }

    getItemsForModule(module: string, version: string = "") {
        console.log("getItemsForModule called");

        let tfApi = new TerraformApi();
        return tfApi.makeModuleRequest(module, version).then(resp => {
            if (resp) {
                var args = resp["root"]["inputs"];
            } else {
                return false;
            }
            
            return _.map(args, o => {
                let c = new CompletionItem(`${o.name} (${module})`, CompletionItemKind.Property);
                c.kind = CompletionItemKind.Variable;
                let def = "";
                if (o.required) {
                    def = "Required - "
                } else {
                    def = `Optional (Default: ${o.default}) - `
                }
                c.detail = def + o.description;
                c.insertText = o.name;
                return c;
            })

        });
    }

    getOutputsForModule(module: string, version: string = "") {
        console.log("getOutputsForModule called");

        let tfApi = new TerraformApi();
        return tfApi.makeModuleRequest(module, version).then(resp => {
            if (resp) {
                var args = resp["root"]["outputs"];
            } else {
                return false;
            }
            
            return _.map(args, o => {
                let c = new CompletionItem(`${o.name} (${module})`, CompletionItemKind.Property);
                c.kind = CompletionItemKind.Variable;
                c.detail = o.description;
                c.insertText = o.name;
                return c;
            })

        });
    }
}
