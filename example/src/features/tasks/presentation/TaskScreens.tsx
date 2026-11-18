import { AppFailure, type SessionHandle } from '@react-starter/core';
import {
  ActionButton,
  ActionGroup,
  ActionTile,
  AsyncContent,
  BodyCopy,
  ContentCard,
  NoteInput,
  PageSurface,
  SecondaryAction,
  Section,
  SectionHeading,
  StatusBadge,
} from '@react-starter/ui';
import { useState, type ReactNode } from 'react';
import { failureMessage, Strings } from '../../../l10n/strings';
import type { TaskResource } from '../domain/task';
import { useTask, useTaskList, useTaskRepository } from './taskHooks';

function TaskStatus({ resource }: { readonly resource: TaskResource }) {
  const completed = resource.task?.completed ?? false;
  const label = resource.pending ? Strings.pending : completed ? Strings.completed : Strings.open;
  return <StatusBadge label={label} highlighted={completed} />;
}

export function TaskListScreen({
  session,
  actions,
  openTask,
}: {
  readonly session: SessionHandle;
  readonly actions: ReactNode;
  readonly openTask: (id: string) => void;
}) {
  const repository = useTaskRepository();
  const data = useTaskList(session);
  const refresh = () => void repository?.refreshList().catch(() => {});
  const tasks = data?.tasks.filter((resource) => resource.task) ?? [];
  return (
    <PageSurface title={Strings.tasks}>
      <SectionHeading
        title={Strings.taskHeading}
        eyebrow={Strings.workspace}
        description={Strings.taskSubtitle}
      />
      {actions}
      <SecondaryAction label={Strings.refresh} onPress={refresh} />
      <AsyncContent
        loadingLabel={Strings.loading}
        emptyLabel={Strings.empty}
        retryLabel={Strings.retry}
        // Before the repository has state for this session, the list is still on its way.
        loading={data?.loading ?? true}
        errorMessage={data?.failure ? failureMessage(data.failure) : undefined}
        onRetry={refresh}
        content={
          tasks.length === 0 ? null : (
            <Section>
              {tasks.map((resource) => (
                <ActionTile
                  key={resource.task!.id}
                  title={resource.task!.title}
                  highlighted={resource.task!.completed}
                  status={<TaskStatus resource={resource} />}
                  onPress={() => openTask(resource.task!.id)}
                />
              ))}
            </Section>
          )
        }
      />
    </PageSurface>
  );
}

export function TaskDetailScreen({
  session,
  taskId,
  actions,
  rejectNext,
  loseNext,
}: {
  readonly session: SessionHandle;
  readonly taskId: string;
  readonly actions: ReactNode;
  /** Optional demo controls; omitted in a real app. */
  readonly rejectNext?: () => void;
  readonly loseNext?: () => void;
}) {
  const repository = useTaskRepository();
  const data = useTask(session, taskId);
  const refresh = () => void repository?.refresh(taskId).catch(() => {});

  async function submit(note: string) {
    if (!repository || !session.isActive || !data) return;
    try {
      if (data.needsRetry) await repository.retryCompletion(taskId);
      else await repository.complete(taskId, note);
    } catch (error) {
      // Repository state owns recovery; the form retains its draft.
      if (!(error instanceof AppFailure)) throw error;
    }
  }

  return (
    <PageSurface title={Strings.taskDetail}>
      {actions}
      <SecondaryAction label={Strings.refresh} onPress={refresh} />
      <AsyncContent
        loadingLabel={Strings.loading}
        emptyLabel={Strings.empty}
        retryLabel={Strings.retry}
        loading={data?.loading ?? true}
        errorMessage={data?.failure ? failureMessage(data.failure) : undefined}
        onRetry={refresh}
        content={
          data?.task ? (
            <TaskForm resource={data} submit={submit} rejectNext={rejectNext} loseNext={loseNext} />
          ) : null
        }
      />
    </PageSurface>
  );
}

function TaskForm({
  resource,
  submit,
  rejectNext,
  loseNext,
}: {
  readonly resource: TaskResource;
  readonly submit: (note: string) => Promise<void>;
  readonly rejectNext?: (() => void) | undefined;
  readonly loseNext?: (() => void) | undefined;
}) {
  // The draft is local to this screen instance. An account switch remounts the screen, so a
  // draft can never follow the user into another account.
  const [note, setNote] = useState('');
  const task = resource.task!;
  const settled = task.completed && !resource.pending && !resource.needsRetry;
  const canSubmit = note.trim() !== '' || resource.needsRetry;
  return (
    <Section>
      <TaskStatus resource={resource} />
      <SectionHeading title={task.title} />
      {settled ? (
        <ContentCard>
          <BodyCopy>{task.note}</BodyCopy>
        </ContentCard>
      ) : (
        <>
          <NoteInput
            value={note}
            onChange={setNote}
            label={Strings.note}
            hint={Strings.noteHint}
            readOnly={resource.pending || resource.needsRetry}
          />
          <ActionButton
            label={resource.needsRetry ? Strings.retryCompletion : Strings.complete}
            pendingLabel={Strings.saving}
            pending={resource.pending}
            onPress={canSubmit ? () => void submit(note) : undefined}
          />
          {(rejectNext || loseNext) && (
            <>
              <BodyCopy>{Strings.simulations}</BodyCopy>
              <ActionGroup>
                {rejectNext && (
                  <SecondaryAction
                    label={Strings.rejectNext}
                    onPress={resource.pending ? undefined : rejectNext}
                  />
                )}
                {loseNext && (
                  <SecondaryAction
                    label={Strings.loseNext}
                    onPress={resource.pending ? undefined : loseNext}
                  />
                )}
              </ActionGroup>
            </>
          )}
        </>
      )}
    </Section>
  );
}
