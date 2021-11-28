import React from 'react';
import TablePage from "./pages/TablePage";
import Home from "./pages/Home";
import ApprovePage from "./pages/ApprovePage";
import WizardPage from "./pages/WizardPage";
import ModalPage from "./pages/ModalPage";
import FormPage from "./pages/FormPage";
import {Container, Navbar, Nav} from "react-bootstrap";
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Link
} from "react-router-dom";

import 'bootstrap/dist/css/bootstrap.min.css';

function App() {
  return (
    <Router>
      <Container>
        <Navbar expand="lg">
          <Navbar.Brand href="/">PixieBrix Sandbox</Navbar.Brand>
          <Navbar.Toggle aria-controls="basic-navbar-nav" />
           <Navbar.Collapse id="basic-navbar-nav">
            <Nav className="mr-auto">
              <Nav.Link as={Link} to="/">Home</Nav.Link>
              <Nav.Link as={Link} to="/table">Table</Nav.Link>
              <Nav.Link as={Link} to="/approve">Approval</Nav.Link>
              <Nav.Link as={Link} to="/modals">Modals</Nav.Link>
              <Nav.Link as={Link} to="/forms">Forms</Nav.Link>
              <Nav.Link as={Link} to="/wizard">Wizard</Nav.Link>
            </Nav>
          </Navbar.Collapse>
        </Navbar>
         <Switch>
            <Route path="/table">
              <TablePage />
            </Route>
            <Route path="/approve">
              <ApprovePage />
            </Route>
            <Route path="/modals">
              <ModalPage />
            </Route>
             <Route path="/forms">
              <FormPage />
            </Route>
            <Route path="/wizard">
              <WizardPage />
            </Route>
            <Route path="/">
              <Home />
            </Route>
        </Switch>
      </Container>
    </Router>
  );
}

export default App;
