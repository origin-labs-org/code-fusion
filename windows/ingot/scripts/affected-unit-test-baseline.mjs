export function selectDefaultBranchRef({ originHead, hasCommit }) {
  return ["origin/staging", originHead, "origin/main", "origin/master", "main", "master"].find(
    (candidate) => candidate && hasCommit(candidate),
  );
}
