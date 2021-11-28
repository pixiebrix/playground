import React, {useCallback} from "react";
import Page from "./Page";
import {Button} from "react-bootstrap"

const ApprovePage = () => {

  const reject = useCallback(() => {
    window.alert("Rejected");
  }, []);

  const approve = useCallback(() => {
    window.alert("Approved");
  }, []);

  return (
    <Page title="Approve">
      <div className="approve-actions">
        <Button variant="danger" id="rejectBtn" onClick={reject}>Reject</Button>
        <Button className="mx-2" id="approveBtn" onClick={approve}>Approve</Button>
      </div>
      <div>
        <ul className="mt-2">
          <li><a href="/table" target="blank">Open transaction table</a></li>
          <li><a href="/modals" target="blank">Open other page</a></li>
        </ul>
      </div>
    </Page>
  );
}

export default ApprovePage;