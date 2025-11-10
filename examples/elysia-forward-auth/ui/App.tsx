import { AdminShell } from '@catalyst-auth/ui-admin';
import { buildClients } from './clients';

export function App() {
  const clients = buildClients();
  return <AdminShell clients={clients} />;
}
