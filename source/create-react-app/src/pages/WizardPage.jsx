import React from "react";
import {Wizard, Step, Controls} from "react-decision-tree-flow";
import Page from "./Page";

export const BasicTree = () => {
  const tree = {
    step1: ['step2'],
    step2: ['step3', 'error'],
    step3: [],
    error: ['step2'],
  };
 
  return (
    <Wizard tree={tree} first="step1">
      <Step name="step1">
        <div>
          I am step 1
          <br />
          <Controls>
            {({ destinations: { step2 } }) => (
              <button onClick={step2}>Go to Step 2</button>
            )}
          </Controls>
        </div>
      </Step>
      <Step name="step2">
        <div>
          I am step 2
          <br />
          <Controls>
            {({ destinations: { step3, error } }) => (
              <div>
                <button onClick={error}>Go to error</button>
                <button onClick={step3}>Go to Step 3</button>
              </div>
            )}
          </Controls>
        </div>
      </Step>
      <Step name="step3">
        <div>I am step 3. No steps after me!</div>
      </Step>
      <Step name="error">
        <div>
          I am error
          <br />
          <Controls>
            {({ back }) => <button onClick={back}>Go back to Step 2</button>}
          </Controls>
        </div>
      </Step>
    </Wizard>
  );
};

const WizardPage = () => {
  return (
    <Page title="Wizard">
      
      <div className="wizard">
        <div>
          <h3 className="wizard-title">Example Workflow Name</h3>
        </div>
        <div>
          <BasicTree />
        </div>
      </div>
    </Page>
  );
}

export default WizardPage;
