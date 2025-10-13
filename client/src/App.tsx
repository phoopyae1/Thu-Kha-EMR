import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import RouteGuard from './components/RouteGuard';
import Patients from './pages/Patients';
import PatientDetail from './pages/PatientDetail';
import VisitDetail from './pages/VisitDetail';
import AddVisit from './pages/AddVisit';
import Cohort from './pages/Cohort';
import Settings from './pages/Settings';
import Home from './pages/Home';
import RegisterPatient from './pages/RegisterPatient';
import AppointmentsPage from './pages/AppointmentsPage';
import AppointmentForm from './pages/AppointmentForm';
import AppointmentDetail from './pages/AppointmentDetail';
import Reports from './pages/Reports';
import PharmacyQueue from './pages/PharmacyQueue';
import DispenseDetail from './pages/DispenseDetail';
import PharmacyInventory from './pages/PharmacyInventory';
import AddDrug from './pages/AddDrug';
import VisitBilling from './pages/VisitBilling';
import PosList from './pages/PosList';
import BillingWorkspace from './pages/BillingWorkspace';
import SettingsServices from './pages/SettingsServices';
import ProblemList from './pages/ProblemList';
import LabOrdersPage from './pages/LabOrders';
import LabOrderDetailPage from './pages/LabOrderDetail';
import PatientPortal from './pages/PatientPortal';
import './styles/App.css';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/patient-portal" element={<PatientPortal />} />
      <Route
        path="/patients"
        element={
          <RouteGuard>
            <Patients />
          </RouteGuard>
        }
      />
      <Route
        path="/patients/:id"
        element={
          <RouteGuard>
            <PatientDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/patients/:patientId/problems"
        element={
          <RouteGuard allowedRoles={['Doctor', 'Nurse', 'ITAdmin']}>
            <ProblemList />
          </RouteGuard>
        }
      />
      <Route
        path="/appointments"
        element={
          <RouteGuard allowedRoles={['Doctor', 'AdminAssistant']}>
            <AppointmentsPage />
          </RouteGuard>
        }
      />
      <Route
        path="/appointments/new"
        element={
          <RouteGuard allowedRoles={['AdminAssistant']}>
            <AppointmentForm />
          </RouteGuard>
        }
      />
      <Route
        path="/appointments/:id"
        element={
          <RouteGuard allowedRoles={['Doctor', 'AdminAssistant']}>
            <AppointmentDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/patients/:id/visits/new"
        element={
          <RouteGuard>
            <AddVisit />
          </RouteGuard>
        }
      />
      <Route
        path="/"
        element={
          <RouteGuard>
            <Home />
          </RouteGuard>
        }
      />
      <Route
        path="/register"
        element={
          <RouteGuard allowedRoles={['AdminAssistant', 'ITAdmin']}>
            <RegisterPatient />
          </RouteGuard>
        }
      />
      <Route
        path="/visits/:id"
        element={
          <RouteGuard>
            <VisitDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/cohort"
        element={
          <RouteGuard>
            <Cohort />
          </RouteGuard>
        }
      />
      <Route
        path="/reports"
        element={
          <RouteGuard>
            <Reports />
          </RouteGuard>
        }
      />
      <Route
        path="/lab-orders"
        element={
          <RouteGuard allowedRoles={['Doctor', 'LabTech', 'ITAdmin']}>
            <LabOrdersPage />
          </RouteGuard>
        }
      />
      <Route
        path="/lab-orders/:labOrderId"
        element={
          <RouteGuard allowedRoles={['Doctor', 'LabTech', 'ITAdmin']}>
            <LabOrderDetailPage />
          </RouteGuard>
        }
      />
      <Route
        path="/pharmacy/queue"
        element={
          <RouteGuard allowedRoles={['Pharmacist', 'PharmacyTech', 'InventoryManager', 'ITAdmin']}>
            <PharmacyQueue />
          </RouteGuard>
        }
      />
      <Route
        path="/pharmacy/inventory"
        element={
          <RouteGuard allowedRoles={['InventoryManager', 'ITAdmin']}>
            <PharmacyInventory />
          </RouteGuard>
        }
      />
      <Route
        path="/pharmacy/drugs/new"
        element={
          <RouteGuard allowedRoles={['InventoryManager', 'ITAdmin']}>
            <AddDrug />
          </RouteGuard>
        }
      />
      <Route
        path="/billing/workspace"
        element={
          <RouteGuard allowedRoles={['Cashier', 'ITAdmin', 'Doctor', 'Pharmacist']}>
            <BillingWorkspace />
          </RouteGuard>
        }
      />
      <Route
        path="/billing/visit/:visitId"
        element={
          <RouteGuard allowedRoles={['Cashier', 'ITAdmin', 'Doctor', 'Pharmacist']}>
            <VisitBilling />
          </RouteGuard>
        }
      />
      <Route
        path="/billing/pos"
        element={
          <RouteGuard allowedRoles={['Cashier', 'ITAdmin']}>
            <PosList />
          </RouteGuard>
        }
      />
      <Route
        path="/pharmacy/dispense/:prescriptionId"
        element={
          <RouteGuard allowedRoles={['Pharmacist', 'PharmacyTech']}>
            <DispenseDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/settings"
        element={
          <RouteGuard allowedRoles={['ITAdmin']}>
            <Settings />
          </RouteGuard>
        }
      />
      <Route
        path="/settings/services"
        element={
          <RouteGuard allowedRoles={['ITAdmin']}>
            <SettingsServices />
          </RouteGuard>
        }
      />
    </Routes>
  );
}

export default App;
