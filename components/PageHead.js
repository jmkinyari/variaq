export default function PageHead({ title, desc, crumbs, children }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
