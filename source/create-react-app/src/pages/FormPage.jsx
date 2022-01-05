import React, {useCallback} from "react";
import Page from "./Page";
import { Formik, Field } from 'formik';
import {Form, Button, Row, Col} from "react-bootstrap";

const FormPage = () => {

  const submit = useCallback(() => {
    window.alert("Submitted refund");
  }, []);

  return (
    <Page title="Refund Form">
        <Row>
          <Col md={6} className="mx-auto">
        <h3>Enter Refund</h3>
          <Formik
            initialValues={{ orderAmount: '45.00', refundAmount: '' }}
            onSubmit={submit}
          >
            {({values, handleSubmit}) => (
              <div>
                  <Form.Group controlId="originalAmount" className="mb-3">
                    <Form.Label>Order Amount</Form.Label>
                    <Field name="orderAmount">
                      {({field}) => <Form.Control readOnly type="text" {...field} />}
                    </Field>
                  </Form.Group>
                  <Form.Group controlId="refundAmount" className="mb-3">
                    <Form.Label>Refund Amount</Form.Label>
                    <Field name="refundAmount">
                      {({field}) => <Form.Control type="text" {...field} />}
                    </Field>
                  </Form.Group>
            
                <Button variant="primary" onClick={handleSubmit}>
                  Submit
                </Button>
          </div>
            )}
          </Formik>
          </Col>
        </Row>
    </Page>
  );
}

export default FormPage;