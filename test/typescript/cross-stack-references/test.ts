import { TestDriver } from "../../test-helper";

describe("cross stack references", () => {
  let driver: TestDriver;

  beforeAll(async () => {
    driver = new TestDriver(__dirname);
    await driver.setupTypescriptProject();
    console.log(driver.workingDirectory);
    await driver.synth();
  });

  test("synth generates JSON", () => {
    expect(driver.synthesizedStack("source").toString()).toMatchSnapshot();
    expect(driver.synthesizedStack("passthrough").toString()).toMatchSnapshot();
    expect(driver.synthesizedStack("sink").toString()).toMatchSnapshot();

    expect(driver.manifest()).toMatchSnapshot();
  });

  it.todo("references primitive values");
  it.todo("references can be passed through stacks");
  it.todo("can use reference in terraform function");

  it.todo("references terraform function output");

  it.todo("references complex values");
  it.todo("references nested values");
});
