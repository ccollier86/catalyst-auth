import { FormEvent, useState } from 'react';
import { tokens } from '../../theme/tokens.js';
import {
  useCreateKeyMutation,
  useKeysQuery,
  useRevokeKeyMutation
} from '../../hooks/useAdminQueries.js';

export function KeysView() {
  const keys = useKeysQuery();
  const createKey = useCreateKeyMutation();
  const revokeKey = useRevokeKeyMutation();
  const [label, setLabel] = useState('');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    void createKey.mutateAsync({ label }).then(() => setLabel(''));
  };

  return (
    <div
      style={{
        fontFamily: tokens.typography.fontFamily,
        padding: tokens.spacing.lg,
        color: tokens.color.text
      }}
    >
      <h1 style={{ fontWeight: tokens.typography.headingWeight }}>Keys</h1>
      <form onSubmit={onSubmit} aria-label="create key" style={{ marginTop: tokens.spacing.md }}>
        <label style={{ display: 'block', marginBottom: tokens.spacing.sm }}>
          <span style={{ display: 'block', marginBottom: tokens.spacing.xs }}>Key label</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
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
          disabled={createKey.isPending}
          style={{
            background: tokens.color.primary,
            color: 'white',
            borderRadius: tokens.radius.sm,
            border: 'none',
            padding: `${tokens.spacing.xs} ${tokens.spacing.md}`
          }}
        >
          Create key
        </button>
      </form>

      <section aria-live="polite" style={{ marginTop: tokens.spacing.lg }}>
        {keys.isLoading ? <p>Loading keys…</p> : null}
        {keys.data ? (
          <table style={{ width: '100%', marginTop: tokens.spacing.md, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: tokens.spacing.xs, borderBottom: `1px solid ${tokens.color.border}` }}>
                  Label
                </th>
                <th style={{ textAlign: 'left', padding: tokens.spacing.xs, borderBottom: `1px solid ${tokens.color.border}` }}>
                  Created
                </th>
                <th style={{ padding: tokens.spacing.xs, borderBottom: `1px solid ${tokens.color.border}` }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.data.map((key) => (
                <tr key={key.id}>
                  <td style={{ padding: tokens.spacing.xs }}>{key.label}</td>
                  <td style={{ padding: tokens.spacing.xs }}>{new Date(key.createdAt).toLocaleString()}</td>
                  <td style={{ padding: tokens.spacing.xs }}>
                    <button
                      type="button"
                      onClick={() => void revokeKey.mutateAsync(key.id)}
                      disabled={revokeKey.isPending}
                      style={{
                        background: tokens.color.danger,
                        color: 'white',
                        borderRadius: tokens.radius.sm,
                        border: 'none',
                        padding: `${tokens.spacing.xs} ${tokens.spacing.sm}`
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
