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
import PatientPortalLanding from './pages/PatientPortalLanding';
import './styles/App.css';

function App() {
  return (
    <Routes>
      {/* Patient Portal Routes - Root Level */}
      <Route path="/" element={<PatientPortalLanding />} />
      <Route path="/login" element={<PatientPortal />} />
      <Route path="/:patientId" element={<PatientPortal />} />
      
      {/* Admin Login */}
      <Route path="/admin/login" element={<Login />} />
      
      {/* Admin Routes - Protected with /admin/{adminId} format */}
      <Route
        path="/admin/:adminId"
        element={
          <RouteGuard>
            <Home />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/patients"
        element={
          <RouteGuard>
            <Patients />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/patients/:id"
        element={
          <RouteGuard>
            <PatientDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/patients/:patientId/problems"
        element={
          <RouteGuard allowedRoles={['Doctor', 'Nurse', 'ITAdmin']}>
            <ProblemList />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/appointments"
        element={
          <RouteGuard allowedRoles={['Doctor', 'AdminAssistant']}>
            <AppointmentsPage />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/appointments/new"
        element={
          <RouteGuard allowedRoles={['AdminAssistant']}>
            <AppointmentForm />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/appointments/:id"
        element={
          <RouteGuard allowedRoles={['Doctor', 'AdminAssistant']}>
            <AppointmentDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/patients/:id/visits/new"
        element={
          <RouteGuard>
            <AddVisit />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/register"
        element={
          <RouteGuard allowedRoles={['AdminAssistant', 'ITAdmin']}>
            <RegisterPatient />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/visits/:id"
        element={
          <RouteGuard>
            <VisitDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/cohort"
        element={
          <RouteGuard>
            <Cohort />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/reports"
        element={
          <RouteGuard>
            <Reports />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/lab-orders"
        element={
          <RouteGuard allowedRoles={['Doctor', 'LabTech', 'ITAdmin']}>
            <LabOrdersPage />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/lab-orders/:labOrderId"
        element={
          <RouteGuard allowedRoles={['Doctor', 'LabTech', 'ITAdmin']}>
            <LabOrderDetailPage />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/pharmacy/queue"
        element={
          <RouteGuard allowedRoles={['Pharmacist', 'PharmacyTech', 'InventoryManager', 'ITAdmin']}>
            <PharmacyQueue />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/pharmacy/inventory"
        element={
          <RouteGuard allowedRoles={['InventoryManager', 'ITAdmin']}>
            <PharmacyInventory />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/pharmacy/drugs/new"
        element={
          <RouteGuard allowedRoles={['InventoryManager', 'ITAdmin']}>
            <AddDrug />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/billing/workspace"
        element={
          <RouteGuard allowedRoles={['Cashier', 'ITAdmin', 'Doctor', 'Pharmacist']}>
            <BillingWorkspace />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/billing/visit/:visitId"
        element={
          <RouteGuard allowedRoles={['Cashier', 'ITAdmin', 'Doctor', 'Pharmacist']}>
            <VisitBilling />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/billing/pos"
        element={
          <RouteGuard allowedRoles={['Cashier', 'ITAdmin']}>
            <PosList />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/pharmacy/dispense/:prescriptionId"
        element={
          <RouteGuard allowedRoles={['Pharmacist', 'PharmacyTech']}>
            <DispenseDetail />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/settings"
        element={
          <RouteGuard allowedRoles={['ITAdmin']}>
            <Settings />
          </RouteGuard>
        }
      />
      <Route
        path="/admin/:adminId/settings/services"
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
