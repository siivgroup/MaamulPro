export function taskProgress(status?: string): number {
  switch (status) {
    case 'COMPLETED':
      return 100;
    case 'IN_PROGRESS':
      return 50;
    case 'NOT_STARTED':
    case 'BLOCKED':
    default:
      return 0;
  }
}

export function projectProgress(tasks: { status: string }[] = []): number {
  if (!tasks || !tasks.length) return 0;
  const totalScore = tasks.reduce((sum, task) => sum + taskProgress(task.status), 0);
  return Math.min(100, Math.max(0, Math.round(totalScore / tasks.length)));
}

export function determineProjectStatus(
  currentStatus: string,
  tasks: { status: string }[] = [],
): string {
  // Respect manual override / explicit holds
  if (currentStatus === 'ON_HOLD' || currentStatus === 'CANCELLED') {
    return currentStatus;
  }

  if (!tasks || !tasks.length) {
    return currentStatus;
  }

  const allCompleted = tasks.every((t) => t.status === 'COMPLETED');
  if (allCompleted) {
    return 'COMPLETED';
  }

  const hasStartedOrDone = tasks.some(
    (t) => t.status === 'IN_PROGRESS' || t.status === 'COMPLETED',
  );

  if (hasStartedOrDone) {
    if (currentStatus === 'PLANNING' || currentStatus === 'COMPLETED') {
      return 'ONGOING';
    }
    return currentStatus;
  }

  // All tasks are NOT_STARTED or BLOCKED
  if (currentStatus === 'COMPLETED') {
    return 'PLANNING';
  }

  return currentStatus;
}
