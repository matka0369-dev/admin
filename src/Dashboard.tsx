import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ADMIN_ASSIGNABLE_PERMISSION_KEYS,
  AdminPredictionsCard,
  AgentSummaryCard,
  Alert,
  Card,
  CreateUserForm,
  GameEnablementCard,
  Layout,
  LedgerCard,
  MySessionsCard,
  RatesSection,
  RequestQueueCard,
  Section,
  SettlementsCard,
  Stat,
  UserTable,
  api,
  useAuth,
  type NavItem,
  type Role,
  type UserSummary,
} from './shared';

export function Dashboard() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  // LedgerCard fetches on mount only, so a grant made elsewhere on this page
  // (an opening balance at account creation) never reaches it without an
  // explicit nudge — bumped every time load() runs.
  const [ledgerVersion, setLedgerVersion] = useState(0);

  // Only a native Admin creates/manages its own staff roster — a staff
  // account (ADMIN_STAFF) never gets to create further staff, so this app
  // hides that whole section for it rather than showing controls that would
  // just 403 on the server.
  const isNativeAdmin = user?.accountType === 'ADMIN';
  // A native Admin's authority over its own Agents/Players is intrinsic —
  // no permission needed, mirroring a native Agent's intrinsic authority
  // over its own Players (see the Agent portal). Only its staff
  // (ADMIN_STAFF) needs the explicit role.
  //
  // canManageAgents gates creating an Agent *and* managing one (status,
  // sessions) — Agent creation is the only account-creation capability left
  // on this dashboard. canManagePlayers gates managing an *existing* Player
  // only: Admin (native or staff) never creates a Player or assigns one to
  // an Agent — that's the creating Agent's own doing, fixed at birth. See
  // ARCHITECTURE.md "Native tier authority is intrinsic".
  const canManageAgents = isNativeAdmin || (user?.permissions.includes('agent:manage') ?? false);
  const canManagePlayers = isNativeAdmin || (user?.permissions.includes('user:manage') ?? false);
  const canManageAny = canManageAgents || canManagePlayers;

  // Sections gated on a permission this account doesn't hold don't render at
  // all, so the nav shouldn't offer to jump to them either.
  const nav = useMemo<NavItem[]>(
    () => [
      { id: 'overview', label: 'Overview' },
      ...(canManageAgents ? [{ id: 'create', label: 'Create account' }] : []),
      { id: 'agents', label: 'Your agents' },
      { id: 'players', label: 'Your players' },
      { id: 'rates', label: 'Rate card' },
      { id: 'games', label: 'Games' },
      { id: 'predictions', label: 'Predictions' },
      { id: 'settlements', label: 'Settlements' },
      { id: 'summary', label: 'By agent' },
      { id: 'requests', label: 'Token requests' },
      { id: 'ledger', label: 'Token history' },
      ...(isNativeAdmin
        ? [
            { id: 'staff-create', label: 'Create staff' },
            { id: 'staff', label: 'Your staff' },
          ]
        : []),
      { id: 'sessions', label: 'Your sessions' },
      { id: 'coming-next', label: 'Coming next' },
    ],
    [canManageAgents, isNativeAdmin],
  );

  const load = useCallback(async () => {
    try {
      // Role assignment is only ever shown to a native Admin creating its own
      // staff (see isNativeAdmin below) — a staff account itself has no use
      // for the catalog, so skip the call rather than needing the API to
      // allow it too.
      const [u, r] = await Promise.all([
        api.listUsers(),
        isNativeAdmin ? api.listRoles() : Promise.resolve([]),
      ]);
      setUsers(u);
      setRoles(r);
      setError(null);
      setLedgerVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [isNativeAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const agents = users.filter((u) => u.accountType === 'AGENT');
  const players = users.filter((u) => u.accountType === 'PLAYER');
  const staff = users.filter((u) => u.accountType === 'ADMIN_STAFF');

  // Moderator (moderation:manage) only gates an AGENT_STAFF moderating a
  // Player — granting it to an ADMIN_STAFF account would authorize nothing,
  // same as any role held by a Player. Filtered here so it's never offered;
  // the server enforces the same rule independently either way.
  const staffAssignableRoles = useMemo(
    () =>
      roles.filter((r) =>
        r.permissions.every((rp) => ADMIN_ASSIGNABLE_PERMISSION_KEYS.has(rp.permission.key)),
      ),
    [roles],
  );

  return (
    <Layout
      title="Welcome, Admin"
      subtitle={
        isNativeAdmin
          ? 'Your agents and their players — full authority, intrinsic to this account.'
          : 'Your agents and their players. Capabilities come from roles this Admin granted you.'
      }
      nav={nav}
    >
      {error && <Alert tone="error">{error}</Alert>}

      {/* Only ever shows for a staff account — a native Admin's authority is
          intrinsic and canManageAny is always true for it. */}
      {!canManageAny && (
        <Alert tone="info">
          You don't hold the <strong>Agent Manager</strong> or <strong>User Manager</strong> role,
          so account management is read-only. The Admin who created this staff account can grant
          one.
        </Alert>
      )}

      <Section id="overview">
        <div className="grid grid--stats">
          <Stat label="Your agents" value={agents.length} />
          <Stat label="Your players" value={players.length} />
          {/* A native Admin never holds a role — its authority is intrinsic
              — so "0" here would read as a limitation rather than the full
              access it actually has. Only staff have a meaningful count. */}
          <Stat
            label="Your permissions"
            value={isNativeAdmin ? 'Full (intrinsic)' : (user?.permissions.length ?? 0)}
          />
        </div>
      </Section>

      {/* Agent is the only account type an Admin (or its staff) creates
          directly. A Player has exactly one possible Agent — whichever
          Agent creates it — so there's no Admin-side creation step or
          reassignment tool for Players at all; see "Your players" below,
          which is management-only. */}
      {canManageAgents && (
        <Section id="create">
          <CreateUserForm allowedTypes={['AGENT']} onCreated={() => void load()} />
        </Section>
      )}

      <Section id="agents">
        <UserTable
          title="Your agents"
          desc="Agent accounts you (or your staff) created."
          users={agents}
          canManage={canManageAgents}
          onChanged={() => void load()}
        />
      </Section>

      <Section id="players">
        <UserTable
          title="Your players"
          desc="Created by your agents, for themselves — you can manage them, but not create or reassign them."
          users={players}
          canManage={canManagePlayers}
          onChanged={() => void load()}
        />
      </Section>

      <Section id="rates">
        <RatesSection />
      </Section>

      <Section id="games">
        <GameEnablementCard />
      </Section>

      {/* Aggregated, not itemised: an Admin cares about exposure per number
          across the whole subtree, and the per-player detail stays with the
          Agent that owns the Player. */}
      <Section id="predictions">
        <AdminPredictionsCard agents={agents} />
      </Section>

      {/* The persisted Admin<->Agent position. The Agent sees these exact
          rows from the other side. */}
      <Section id="settlements">
        <SettlementsCard />
      </Section>

      <Section id="summary">
        <AgentSummaryCard />
      </Section>

      <Section id="requests">
        <RequestQueueCard viewerId={user?.id} />
      </Section>

      <Section id="ledger">
        <LedgerCard
          title="Token history"
          desc="Every token movement across your agents and their players."
          refreshKey={ledgerVersion}
          showDateFilter
          agents={agents.map((a) => ({ id: a.id, username: a.username }))}
        />
      </Section>

      {isNativeAdmin && (
        <Section id="staff-create">
          <CreateUserForm allowedTypes={['ADMIN_STAFF']} roles={staffAssignableRoles} onCreated={() => void load()} />
        </Section>
      )}

      {isNativeAdmin && (
        <Section id="staff">
          <UserTable
            title="Your staff"
            desc="Internal logins that act on your behalf, scoped to whichever roles you grant them."
            users={staff}
            canManage
            onChanged={() => void load()}
          />
        </Section>
      )}

      <Section id="sessions">
        <MySessionsCard />
      </Section>

      <Section id="coming-next">
        <Card title="Coming next" desc="Not yet built.">
          <div className="note">
            Profit/loss allocation against your configured splits (beyond the raw stake/payout
            totals already in "By agent"), reporting dashboards, and support-message handling.
          </div>
        </Card>
      </Section>
    </Layout>
  );
}
