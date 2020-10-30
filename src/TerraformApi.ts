import { 
    DefinitionProvider,
    TextDocument,
    Position,
    CancellationToken,
    Definition,
    workspace,
    version,
    extensions
} from "vscode";
import * as _ from "lodash";
import * as open from "open";
import Axios, * as ax from 'axios';
import * as fs from 'fs';
var urls = require("../../aws-urls.json");
console.log(urls)

const HOME_DIR = require('os').homedir();
const TOKEN_REGEX = /^\s*token = "([a-zA-Z0-9.]+)"$/;
const REGISTRY_URL = 'https://registry.terraform.io';
const PRIVATE_REGISTRY_DOM = 'app.terraform.io'
const PRIVATE_REGISTRY_API = 'https://app.terraform.io/api/registry';
const REGISTRY_MODULES_PATH = '/v1/modules/'

export class TerraformApi {
    public apiTokenExists (): string {
        console.log(`apiTokenExists called`);
        console.log(workspace.getConfiguration('terraform').get('terraformrc_file_path'));

        const tfrcFile = HOME_DIR + '/.terraformrc';
        console.log(tfrcFile);

        if (fs.existsSync(tfrcFile)) {
            let tfrcContents = fs.readFileSync(tfrcFile, 'utf8');
            for (let line of tfrcContents.split("\n")) {
                if (TOKEN_REGEX.test(line)) {
                    console.log("Successfully found token using regex: ");
                    const token = TOKEN_REGEX.exec(line)[1];
                    console.log(token);
                    return token;
                }
            }
        }

        return "";
    }

    private async makeApiGet(url: string, bearer: string = null) {
        console.log(`makeApiGet`)
        var response;

        const thisExtVersion = extensions.getExtension('mgtrrz.terraform-completer').packageJSON.version

        let options = {
            'headers': {
                'User-Agent': 'Terraform-Completer/v' + thisExtVersion + ' ext VisualStudioCode/' + version,
            },
            json: true
        }
        if (bearer) {
            options["headers"]["Authorization"] = 'Bearer ' + bearer
        }

        return await Axios.get(url, options);

    }

    public makeModuleRequest(module: string, version: string = "") {
        if (module.includes(PRIVATE_REGISTRY_DOM)) {
            var base_registry_url = PRIVATE_REGISTRY_API;
            module = module.replace(PRIVATE_REGISTRY_DOM + "/", "");
        } else {
            var base_registry_url = REGISTRY_URL;
        }

        console.log("Making request..")
        let url = base_registry_url + REGISTRY_MODULES_PATH + module + "/" + version
        console.log(url)
        return this.makeApiGet(url, this.apiTokenExists()).then(resp => {
            console.log("Did we get a response back?")
            console.log(resp);
            return resp["data"];
        }, failure => {
            // Something happened on the original request
            return false;
        });

        // console.log("Did we get a response back?")
        // console.log(resp)
        // return resp
    }

}
