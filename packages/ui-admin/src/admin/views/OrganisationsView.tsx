import { FormEvent, useState } from 'react';
import { tokens } from '../../theme/tokens.js';
import {
  useCreateOrganisationMutation,
  useOrganisationsQuery,
  useSwitchOrganisationMutation
} from '../../hooks/useAdminQueries.js';

export function OrganisationsView() {
  const organisations = useOrganisationsQuery();
  const createOrganisation = useCreateOrganisationMutation();
  const switchOrganisation = useSwitchOrganisationMutation();
  const [name, setName] = useState('');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void createOrganisation.mutateAsync({ name }).then(() => setName(''));
  };

  return (
    <div
      style={{
        fontFamily: tokens.typography.fontFamily,
        padding: tokens.spacing.lg,
        color: tokens.color.text
      }}
    >
      <h1 style={{ fontWeight: tokens.typography.headingWeight }}>Organisations</h1>
      <form onSubmit={onSubmit} aria-label="create organisation" style={{ marginTop: tokens.spacing.md }}>
        <label style={{ display: 'block', marginBottom: tokens.spacing.sm }}>
          <span style={{ display: 'block', marginBottom: tokens.spacing.xs }}>Organisation name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            aria-required="true"
            style={{
              padding: tokens.spacing.sm,
              borderRadius: tokens.radius.sm,
              border: `1px solid ${tokens.color.border}`,
              width: 'min(420px, 100%)'
            }}
          />
        </label>
        <button
          type="submit"
          disabled={createOrganisation.isPending}
          style={{
            background: tokens.color.primary,
            color: 'white',
            borderRadius: tokens.radius.sm,
            border: 'none',
            padding: `${tokens.spacing.xs} ${tokens.spacing.md}`
          }}
        >
          Create organisation
        </button>
      </form>

      <section aria-live="polite" style={{ marginTop: tokens.spacing.lg }}>
        {organisations.isLoading ? <p>Loading organisations…</p> : null}
        {organisations.data ? (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {organisations.data.map((organisation) => (
              <li
                key={organisation.id}
                style={{
                  marginBottom: tokens.spacing.sm,
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: tokens.radius.md,
                  padding: tokens.spacing.md,
                  background: tokens.color.surface
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{organisation.name}</strong>
                    <p style={{ margin: 0, color: tokens.color.muted }}>Role: {organisation.role}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void switchOrganisation.mutateAsync(organisation.id)}
                    disabled={switchOrganisation.isPending}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${tokens.color.border}`,
                      borderRadius: tokens.radius.sm,
                      padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`
                    }}
                  >
                    Make active
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
