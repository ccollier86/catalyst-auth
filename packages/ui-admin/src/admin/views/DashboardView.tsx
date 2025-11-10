import { useState } from 'react';
import { AuthDialogPrimitive } from '@catalyst-auth/ui-headless';
import { useAdminClients } from '../AdminClientsContext.js';
import { tokens } from '../../theme/tokens.js';
import { useOrganisationsQuery } from '../../hooks/useAdminQueries.js';

export function DashboardView() {
  const clients = useAdminClients();
  const organisations = useOrganisationsQuery();
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        fontFamily: tokens.typography.fontFamily,
        padding: tokens.spacing.lg,
        background: tokens.color.background,
        minHeight: '100%',
        color: tokens.color.text
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontWeight: tokens.typography.headingWeight, marginBottom: tokens.spacing.sm }}>
            Catalyst Admin
          </h1>
          <p style={{ color: tokens.color.muted }}>Manage authentication primitives with confidence.</p>
        </div>
        <AuthDialogPrimitive client={clients.auth} defaultOpen={open}>
          {(state, actions) => (
            <div>
              <button
                type="button"
                onClick={() => {
                  actions.setOpen(!state.open);
                  setOpen(!state.open);
                }}
                style={{
                  background: tokens.color.primary,
                  color: 'white',
                  borderRadius: tokens.radius.md,
                  padding: `${tokens.spacing.xs} ${tokens.spacing.md}`,
                  border: 'none'
                }}
              >
                {state.flowId ? 'Continue sign-in' : 'Launch sign-in'}
              </button>
            </div>
          )}
        </AuthDialogPrimitive>
      </header>

      <section aria-live="polite" style={{ marginTop: tokens.spacing.xl }}>
        <h2 style={{ fontWeight: tokens.typography.headingWeight }}>Organisations</h2>
        {organisations.isLoading ? <p>Loading organisations…</p> : null}
        {organisations.isError ? (
          <p role="alert" style={{ color: tokens.color.danger }}>
            {(organisations.error as Error).message}
          </p>
        ) : null}
        {organisations.data ? (
          <ul style={{ padding: 0, listStyle: 'none', marginTop: tokens.spacing.md }}>
            {organisations.data.map((organisation) => (
              <li
                key={organisation.id}
                style={{
                  background: tokens.color.surface,
                  borderRadius: tokens.radius.md,
                  padding: tokens.spacing.md,
                  marginBottom: tokens.spacing.sm,
                  border: `1px solid ${tokens.color.border}`
                }}
              >
                <strong>{organisation.name}</strong>
                <p style={{ margin: 0, color: tokens.color.muted }}>Role: {organisation.role}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
