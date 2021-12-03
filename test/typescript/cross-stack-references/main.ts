import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, Testing, Fn } from "cdktf";
import { RandomProvider } from "./.gen/providers/random";
import { LocalProvider } from "./.gen/providers/local";

export class SourceStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new RandomProvider(this, "random");
    new LocalProvider(this, "random");
  }
}

const app = Testing.stubVersion(new App({ stackTraces: false }));
new SourceStack(app, "source");
app.synth();
