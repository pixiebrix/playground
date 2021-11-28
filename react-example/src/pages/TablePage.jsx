
import React, {useMemo} from "react";
import Page from "./Page";
import {Table, Button} from "react-bootstrap";
import faker from "faker";
import { useImmer } from "use-immer";


const CURRENCY = "GBP";
const CATEGORIES = ["A", "B"];

const data = [...Array(5).keys()].map(x => ({
  id: x + 1,
  firstName: faker.name.firstName(),
  lastName: faker.name.lastName(),
  amount: `${faker.random.number()} ${CURRENCY}`,
  category: faker.random.arrayElement(CATEGORIES),
  cleared: false,
}));


const TablePage = () => {

  const timestamp = useMemo(() => new Date().toISOString(), []);

  const [rowData, updateData] = useImmer(data);

  return (
    <Page title="Transaction Table">
      <div className="py-2 table-actions">
        <Button onClick={() => {alert("Action #1")}}>Action #1</Button>
        <Button onClick={() => {alert("Action #2")}} variant="info" className="mx-2">Action #2</Button>
        <Button onClick={() => {alert("Action #3")}} variant="danger">Action #3</Button>
      </div>
      
      <div className="timestamp">Table generated at {timestamp}</div>

      <Table striped bordered hover>
        <thead>
          <tr>
            <th>#</th>
            <th>First Name</th>
            <th>Last Name</th>
            <th>Category</th>
            <th>Value</th>
            <th>Cleared</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rowData.map((row, index) => (
              <tr key={index}>
                <td>{row.id}</td>
                <td>{row.firstName}</td>
                <td>{row.lastName}</td>
                <td>{row.category}</td>
                <td>{row.amount}</td>
                <td>{row.cleared ? "Yes" : "No"}</td>
                <td>
                  {!row.cleared && (
                      <Button size="sm" variant="info" onClick={() => updateData((data) => {
                        data[index].cleared = true;
                      })}>
                        Mark Cleared
                      </Button>
                  )}
                </td>
              </tr>
          ))}
        </tbody>
      </Table>
    </Page>
  );
};

export default TablePage;