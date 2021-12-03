import { TestDriver } from "../../test-helper";

describe("cross stack references", () => {
  let driver: TestDriver;

  beforeAll(async () => {
    driver = new TestDriver(__dirname);
    await driver.setupTypescriptProject();
    await driver.synth();

    console.log(driver.workingDirectory);
  });

  test("synth generates JSON", () => {
    expect(driver.synthesizedStack("source").toString()).toMatchSnapshot();
  });
});
