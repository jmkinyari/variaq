export default function Flash({ searchParams }) {
  if (!searchParams) return null;
  return <>
    {searchParams.ok && <div className="alert success">{searchParams.ok}</div>}
    {searchParams.err && <div className="alert error">{searchParams.err}</div>}
  </>;
}
