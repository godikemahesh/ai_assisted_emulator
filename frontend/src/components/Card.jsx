/** Consistent panel: a header row (title + optional actions) and a body. */
export default function Card({ title, subtitle, actions, className = '', bodyClassName = '', children, id }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`card ${className}`} aria-labelledby={headingId}>
      <header className="card-head">
        <div className="card-titles">
          <h2 id={headingId}>{title}</h2>
          {subtitle && <span className="card-sub">{subtitle}</span>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      <div className={`card-body ${bodyClassName}`}>{children}</div>
    </section>
  );
}
