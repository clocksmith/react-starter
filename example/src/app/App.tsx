import type { SessionHandle } from '@react-starter/core';
import {
  ActionButton,
  ActionGroup,
  BodyCopy,
  ContentCard,
  NoticeHost,
  PageSurface,
  SecondaryAction,
  SectionHeading,
  UiTheme,
  useNotice,
} from '@react-starter/ui';
import { useState } from 'react';
import { branding } from '../design_system/branding';
import type { CompletionBehavior } from '../features/tasks/infrastructure/memoryTaskServer';
import { TaskDetailScreen, TaskListScreen } from '../features/tasks/presentation/TaskScreens';
import { Strings } from '../l10n/strings';
import { SessionGate } from './SessionGate';
import { SessionScope, useServices, useSessionCommands, useSessionState } from './composition';

export function StarterApp() {
  const state = useSessionState();
  return (
    <UiTheme seedColor={branding.seedColor} fontFamily={branding.fontFamily}>
      <NoticeHost>
        <SessionGate
          state={state}
          signedOut={() => <SignIn />}
          transitioning={() => (
            <PageSurface title={Strings.title}>
              <BodyCopy>{Strings.switching}</BodyCopy>
            </PageSurface>
          )}
          failure={() => <SignIn failed />}
          ready={(session) => (
            <SessionScope session={session}>
              <SessionRoutes session={session} />
            </SessionScope>
          )}
        />
      </NoticeHost>
    </UiTheme>
  );
}

type Route = { readonly name: 'list' } | { readonly name: 'detail'; readonly taskId: string };

/**
 * Navigation for one session. It lives inside the session gate, so an account switch always
 * starts the next account at its list. Replace with a URL router when deep links matter, and
 * keep that router inside the gate.
 */
function SessionRoutes({ session }: { readonly session: SessionHandle }) {
  const [route, setRoute] = useState<Route>({ name: 'list' });
  const { memoryServer } = useServices();
  const notify = useNotice();

  const simulate = (behavior: CompletionBehavior) => {
    if (!memoryServer || !session.isActive) return;
    memoryServer.simulateNextCompletion(session.key.identity, behavior);
    notify(Strings.failureArmed);
  };

  if (route.name === 'detail') {
    return (
      <TaskDetailScreen
        session={session}
        taskId={route.taskId}
        actions={
          <ActionGroup>
            <SecondaryAction label={Strings.back} onPress={() => setRoute({ name: 'list' })} />
            <AccountActions session={session} />
          </ActionGroup>
        }
        {...(memoryServer
          ? { rejectNext: () => simulate('reject'), loseNext: () => simulate('loseResponse') }
          : {})}
      />
    );
  }
  return (
    <TaskListScreen
      session={session}
      actions={
        <ActionGroup>
          <AccountActions session={session} />
        </ActionGroup>
      }
      openTask={(taskId) => setRoute({ name: 'detail', taskId })}
    />
  );
}

function AccountActions({ session }: { readonly session: SessionHandle }) {
  const { activate, signOut } = useSessionCommands();
  const other = session.key.identity.accountId === 'A' ? 'B' : 'A';
  return (
    <>
      <SecondaryAction
        label={other === 'A' ? Strings.accountA : Strings.accountB}
        onPress={() => activate(other)}
      />
      <SecondaryAction label={Strings.signOut} onPress={signOut} />
    </>
  );
}

function SignIn({ failed = false }: { readonly failed?: boolean }) {
  const { activate } = useSessionCommands();
  return (
    <PageSurface title={Strings.title}>
      <SectionHeading title={Strings.welcome} description={Strings.welcomeDetail} />
      <ContentCard>
        <SectionHeading title={Strings.chooseAccount} />
        <BodyCopy>{failed ? Strings.sessionFailure : Strings.demo}</BodyCopy>
        <ActionButton
          label={Strings.accountA}
          pendingLabel={Strings.switching}
          onPress={() => activate('A')}
        />
        <SecondaryAction label={Strings.accountB} onPress={() => activate('B')} />
      </ContentCard>
    </PageSurface>
  );
}
