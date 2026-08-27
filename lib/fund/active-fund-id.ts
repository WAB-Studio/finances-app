// `/f/<id>/…`, locale already stripped by `usePathname`.
export function activeFundId(pathname: string): string | undefined {
  const [, root, id] = pathname.split("/");
  return root === "f" ? id : undefined;
}
