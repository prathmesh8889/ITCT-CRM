import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { ShieldAlert, ServerCrash, RefreshCw, FlaskConical } from "lucide-react";
import { StoreProvider, useStore } from "./store";
import { enableDemo } from "./lib/api";
import { Btn } from "./components/ui";
import { PrintProvider, ToastHost } from "./components/ui";
import AppLayout from "./components/layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Leads from "./pages/Leads";
import Discovery from "./pages/Discovery";
import Pipeline from "./pages/Pipeline";
import Relations from "./pages/Relations";
import { FollowUps, TasksPage, MeetingsPage, CalendarPage } from "./pages/Workflow";
import Quotations from "./pages/Quotations";
import Invoices from "./pages/Invoices";
import Products from "./pages/Products";
import Reports from "./pages/Reports";
import Assistant from "./pages/Assistant";
import { EmployeesPage, AutomationPage, AuditPage } from "./pages/Admin";
import Settings from "./pages/Settings";
import type { ModuleKey } from "./lib/types";

function NoAccess() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="card a-scale-in max-w-sm p-8 text-center">
        <ShieldAlert size={30} className="mx-auto text-amber-500" />
        <h2 className="hd mt-3 text-[17px]">No permission</h2>
        <p className="mt-1 text-[13px] text-ink-500">Your role doesn't include access to this module. Ask an admin to grant it under Employees & Roles.</p>
      </div>
    </div>
  );
}

function Guard({ mod, children }: { mod: ModuleKey; children: ReactElement }) {
  const { user, can } = useStore();
  if (!user) return <Navigate to="/login" replace />;
  if (!can(mod)) return <NoAccess />;
  return children;
}

function LoginGate() {
  const { user } = useStore();
  if (user) return <Navigate to="/dashboard" replace />;
  return <Login />;
}

function Root() {
  const { user } = useStore();
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route element={user ? <AppLayout /> : <Navigate to="/login" replace />}>
        <Route path="/dashboard" element={<Guard mod="dashboard"><Dashboard /></Guard>} />
        <Route path="/leads" element={<Guard mod="leads"><Leads /></Guard>} />
        <Route path="/discovery" element={<Guard mod="discovery"><Discovery /></Guard>} />
        <Route path="/pipeline" element={<Guard mod="deals"><Pipeline /></Guard>} />
        <Route path="/customers" element={<Guard mod="customers"><Relations /></Guard>} />
        <Route path="/followups" element={<Guard mod="followups"><FollowUps /></Guard>} />
        <Route path="/tasks" element={<Guard mod="tasks"><TasksPage /></Guard>} />
        <Route path="/meetings" element={<Guard mod="meetings"><MeetingsPage /></Guard>} />
        <Route path="/calendar" element={<Guard mod="calendar"><CalendarPage /></Guard>} />
        <Route path="/quotations" element={<Guard mod="quotations"><Quotations /></Guard>} />
        <Route path="/invoices" element={<Guard mod="invoices"><Invoices /></Guard>} />
        <Route path="/products" element={<Guard mod="products"><Products /></Guard>} />
        <Route path="/reports" element={<Guard mod="reports"><Reports /></Guard>} />
        <Route path="/assistant" element={<Guard mod="ai"><Assistant /></Guard>} />
        <Route path="/employees" element={<Guard mod="employees"><EmployeesPage /></Guard>} />
        <Route path="/automation" element={<Guard mod="automation"><AutomationPage /></Guard>} />
        <Route path="/audit" element={<Guard mod="audit"><AuditPage /></Guard>} />
        <Route path="/settings" element={<Guard mod="settings"><Settings /></Guard>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * Production guard: when the CRM backend (Node.js + PostgreSQL) is unreachable
 * we never silently fall back to browser data. The user can retry, or
 * explicitly open the labelled demo workspace.
 */
function ServerDownGate({ children }: { children: ReactElement }) {
  const { serverDown, retryBoot, booting } = useStore();
  if (!serverDown) return children;
  return (
    <div className="dot-grid flex min-h-screen items-center justify-center bg-paper p-6 dark:bg-[#0b1013]">
      <div className="card a-scale-in w-full max-w-md p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-red-300 text-red-500 dark:border-red-900">
          <ServerCrash size={26} />
        </span>
        <h1 className="hd mt-4 text-[20px]">CRM server is unavailable</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          The frontend can't reach <span className="num">http://localhost:8000</span>. Your data is safe in
          PostgreSQL — start the backend and retry. Nothing will be written to this browser in the meantime.
        </p>
        <div className="mt-4 rounded-md bg-ink-50 p-3 text-left dark:bg-ink-800/60">
          <div className="num text-[11px] leading-relaxed text-ink-500">
            cd backend<br />npm start&nbsp;&nbsp;:: node src/server.js
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <Btn onClick={retryBoot} loading={booting}><RefreshCw size={14} /> Retry connection</Btn>
          <Btn variant="outline" onClick={() => { enableDemo(); retryBoot(); }}>
            <FlaskConical size={14} /> Open demo workspace (browser-only, labelled)
          </Btn>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <PrintProvider>
        <HashRouter>
          <ServerDownGate><Root /></ServerDownGate>
          <ToastBridge />
        </HashRouter>
      </PrintProvider>
    </StoreProvider>
  );
}

function ToastBridge() {
  const { toasts, dropToast } = useStore();
  return <ToastHost toasts={toasts} drop={dropToast} />;
}
