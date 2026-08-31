export function projectProgress(tasks: { status: string }[] = []) {
  return tasks.length ? Math.round(tasks.filter((task) => task.status === 'COMPLETED').length * 100 / tasks.length) : 0;
}
