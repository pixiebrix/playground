import React, {useCallback, useState} from "react";
import Page from "./Page";
import {Button, Modal, Form} from "react-bootstrap"
import { Formik, Field } from 'formik';

const FormModal = ({className}) => {
  const [show, setShow] = useState(false);

  const handleClose = useCallback(() => setShow(false), []);
  const handleShow = useCallback(() => setShow(true), []);

  const submit = useCallback(() => {
    window.alert("Submitted!");
    handleClose();
  }, [handleClose]);

  return (
    <>
      <Button variant="info" className={className} id="formBtn" onClick={handleShow}>Open Form</Button>

      <Modal show={show} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title>Form Modal</Modal.Title>
        </Modal.Header>

        <Formik
          initialValues={{ originalAmount: '6.00', newAmount: '' }}
          onSubmit={submit}
        >
          {({values, handleSubmit}) => (
            <>
              <Modal.Body>
                 <Form.Group controlId="modalForm.originalAmount">
                  <Form.Label>Original Amount</Form.Label>
                  <Field name="originalAmount">
                    {({field}) => <Form.Control readOnly type="text" {...field} />}
                  </Field>
                 </Form.Group>
                 <Form.Group controlId="modalForm.newAmount">
                  <Form.Label>New Amount</Form.Label>
                  <Field name="newAmount">
                    {({field}) => <Form.Control type="text" {...field} />}
                  </Field>
                 </Form.Group>
              </Modal.Body>
                 <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
          <Button variant="primary" onClick={handleSubmit}>
            Save Changes
          </Button>
        </Modal.Footer>
            </>
          )}
        </Formik>
      </Modal>
    </>
  );
}


const InfoModal = ({className}) => {
  const [show, setShow] = useState(false);

  const handleClose = useCallback(() => setShow(false), []);
  const handleShow = useCallback(() => setShow(true), []);

  return (
    <>
      <Button variant="info" className={className} id="infoBtn" onClick={handleShow}>Open Info</Button>

      <Modal show={show} onHide={handleClose}>
        <Modal.Header closeButton>
          <Modal.Title>Info Modal</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          This is some information!
        </Modal.Body>
      </Modal>
    </>
  );
}



const ModalPage = () => {

  return (
    <Page title="Modal Buttons">
      <div className="buttons-toolbar">
        <FormModal className="mx-2" />        
        <InfoModal className="mx-2"/>
      </div>
    </Page>
  );
}

export default ModalPage;