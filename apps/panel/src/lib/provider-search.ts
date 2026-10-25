interface SearchableProvider {
  id: string;
  name?: string;
  vendor?: string;
  prefix?: string | null;
}

export function filterProviders<T extends SearchableProvider>(providers: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return providers;
  return providers.filter((provider) =>
    [provider.id, provider.name, provider.vendor, provider.prefix].some((value) => value?.toLowerCase().includes(needle)),
  );
}
