'use client';

import { AdminShell } from '@catalyst-auth/ui-admin';
import { useMemo } from 'react';
import { buildCatalystClients } from '../../sdk-clients';

export default function AdminPage() {
  const clients = useMemo(() => buildCatalystClients(), []);
  return <AdminShell clients={clients} />;
}
