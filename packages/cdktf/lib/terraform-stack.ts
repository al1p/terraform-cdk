import { Construct, IConstruct, Node } from "constructs";
import { resolve } from "./_tokens";

import { TerraformElement } from "./terraform-element";
import { deepMerge } from "./util";
import { TerraformProvider } from "./terraform-provider";
import {
  EXCLUDE_STACK_ID_FROM_LOGICAL_IDS,
  ALLOW_SEP_CHARS_IN_LOGICAL_IDS,
} from "./features";
import { makeUniqueId } from "./private/unique";
import { IStackSynthesizer } from "./synthesize/types";
import { StackSynthesizer } from "./synthesize/synthesizer";

const STACK_SYMBOL = Symbol.for("cdktf/TerraformStack");
import { ValidateProviderPresence } from "./validations";
import { App } from "./app";
import { TerraformBackend } from "./terraform-backend";
import { LocalBackend, ref, TerraformOutput, TerraformRemoteState } from ".";

export interface TerraformStackMetadata {
  readonly stackName: string;
  readonly version: string;
  readonly backend: string;
}

type Constructor<T> = Function & { prototype: T };
export class TerraformStack extends Construct {
  private readonly rawOverrides: any = {};
  private readonly cdktfVersion: string;
  private crossStackOutputs: Record<string, TerraformOutput> = {};
  private crossStackDataSources: Record<string, TerraformRemoteState> = {};
  public synthesizer: IStackSynthesizer;
  public dependencies: TerraformStack[] = [];

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.cdktfVersion = this.node.tryGetContext("cdktfVersion");
    this.synthesizer = new StackSynthesizer(
      this,
      process.env.CDKTF_CONTINUE_SYNTH_ON_ERROR_ANNOTATIONS !== undefined
    );
    Object.defineProperty(this, STACK_SYMBOL, { value: true });
    this.node.addValidation(new ValidateProviderPresence(this));
  }

  public static isStack(x: any): x is TerraformStack {
    return x !== null && typeof x === "object" && STACK_SYMBOL in x;
  }

  public static of(construct: IConstruct): TerraformStack {
    return _lookup(construct);

    function _lookup(c: IConstruct): TerraformStack {
      if (TerraformStack.isStack(c)) {
        return c;
      }

      const node = c.node;

      if (!node.scope) {
        let hint = "";
        if (
          construct.node.scope === c &&
          c instanceof App &&
          construct instanceof TerraformBackend
        ) {
          // the scope of the originally passed construct equals the construct c
          // which has no scope (i.e. has no parent construct) and c is an App
          // and our construct is a Backend
          hint = `. You seem to have passed your root App as scope to a TerraformBackend construct. Pass a stack as scope to your backend instead.`;
        }

        throw new Error(
          `No stack could be identified for the construct at path '${construct.node.path}'${hint}`
        );
      }

      return _lookup(node.scope);
    }
  }

  public addOverride(path: string, value: any) {
    const parts = path.split(".");
    let curr: any = this.rawOverrides;

    while (parts.length > 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const key = parts.shift()!;

      // if we can't recurse further or the previous value is not an
      // object overwrite it with an object.
      const isObject =
        curr[key] != null &&
        typeof curr[key] === "object" &&
        !Array.isArray(curr[key]);
      if (!isObject) {
        curr[key] = {};
      }

      curr = curr[key];
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastKey = parts.shift()!;
    curr[lastKey] = value;
  }

  public getLogicalId(tfElement: TerraformElement | Node): string {
    // wrap the allocation for future renaming support
    return this.allocateLogicalId(tfElement);
  }

  /**
   * Returns the naming scheme used to allocate logical IDs. By default, uses
   * the `HashedAddressingScheme` but this method can be overridden to customize
   * this behavior.
   *
   * @param tfElement The element for which the logical ID is allocated.
   */
  protected allocateLogicalId(tfElement: TerraformElement | Node): string {
    const node =
      tfElement instanceof TerraformElement ? tfElement.node : tfElement;
    const stack =
      tfElement instanceof TerraformElement ? tfElement.cdktfStack : this;

    let stackIndex;
    if (node.tryGetContext(EXCLUDE_STACK_ID_FROM_LOGICAL_IDS)) {
      stackIndex = node.scopes.indexOf(stack);
    } else {
      stackIndex = 0;
    }

    const components = node.scopes.slice(stackIndex + 1).map((c) => c.node.id);
    return components.length > 0
      ? makeUniqueId(
          components,
          node.tryGetContext(ALLOW_SEP_CHARS_IN_LOGICAL_IDS)
        )
      : "";
  }

  private findAll<T>(ClassConstructor: Constructor<T>): T[] {
    const items: T[] = [];

    const visit = async (node: IConstruct) => {
      if (node instanceof ClassConstructor) {
        items.push(node as unknown as T);
      }

      for (const child of node.node.children) {
        visit(child);
      }
    };

    visit(this);

    return resolve(this, items);
  }

  public allProviders(): TerraformProvider[] {
    return this.findAll(TerraformProvider);
  }

  public get backend(): TerraformBackend {
    const items: TerraformBackend[] = [];

    const visit = async (node: IConstruct) => {
      if (TerraformBackend.isBackend(node)) {
        items.push(node);
      }

      for (const child of node.node.children) {
        visit(child);
      }
    };

    visit(this);

    // There should only be one backend
    // TODO: See if not resolving here causes problems
    return items[0] || new LocalBackend(this, {});
  }

  public prepareStack() {
    // A preparing resolve run might add new resources to the stack
    terraformElements(this).forEach((e) =>
      resolve(this, e.toTerraform(), true)
    );
  }

  public toTerraform(): any {
    const tf = {};

    const metadata: TerraformStackMetadata = {
      version: this.cdktfVersion,
      stackName: this.node.id,
      backend: "local", // overwritten by backend implementations if used
      ...(Object.keys(this.rawOverrides).length > 0
        ? { overrides: { stack: Object.keys(this.rawOverrides) } }
        : {}),
    };

    const elements = terraformElements(this);

    const metadatas = elements.map((e) => resolve(this, e.toMetadata()));
    for (const meta of metadatas) {
      deepMerge(metadata, meta);
    }

    (tf as any)["//"] = { metadata };

    const fragments = elements.map((e) => resolve(this, e.toTerraform()));
    for (const fragment of fragments) {
      deepMerge(tf, fragment);
    }

    deepMerge(tf, this.rawOverrides);

    return resolve(this, tf);
  }

  public registerOutgoingCrossStackReference(identifier: string) {
    if (this.crossStackOutputs[identifier]) {
      return this.crossStackOutputs[identifier];
    }

    const stack = TerraformStack.of(this);

    const output = new TerraformOutput(
      stack,
      `cross-stack-output-${identifier}`,
      {
        value: ref(identifier, stack, true),
        sensitive: true,
      }
    );

    this.crossStackOutputs[identifier] = output;
    return output;
  }

  public registerIncomingCrossStackReference(fromStack: TerraformStack) {
    if (this.crossStackDataSources[String(fromStack)]) {
      return this.crossStackDataSources[String(fromStack)];
    }
    const originBackend = fromStack.backend;

    // TODO: stack name in construct identifier?
    const remoteState = originBackend.getRemoteStateDataSource(
      this,
      `cross-stack-reference-input-${fromStack}`,
      fromStack.toString()
    );

    this.crossStackDataSources[String(fromStack)] = remoteState;
    return remoteState;
  }

  // Check here for loops in the dependency graph
  public dependsOn(stack: TerraformStack): boolean {
    return (
      this.dependencies.includes(stack) ||
      this.dependencies.some((d) => d.dependsOn(stack))
    );
  }

  public addDependency(dependency: TerraformStack) {
    if (dependency.dependsOn(this)) {
      throw new Error(
        `Can not add dependency ${dependency} to ${this} since it would result in a loop`
      );
    }

    if (this.dependencies.includes(dependency)) {
      return;
    }

    this.dependencies.push(dependency);
  }
}

function terraformElements(
  node: IConstruct,
  into: TerraformElement[] = []
): TerraformElement[] {
  if (node instanceof TerraformElement) {
    into.push(node);
  }

  for (const child of node.node.children) {
    // Don't recurse into a substack
    if (TerraformStack.isStack(child)) {
      continue;
    }

    terraformElements(child, into);
  }

  return into;
}
