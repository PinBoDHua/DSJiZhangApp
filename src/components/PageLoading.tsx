export function PageLoading({ screen = false }: { screen?: boolean }) {
  return (
    <div className={`page-loading ${screen ? 'page-loading--screen' : ''}`} aria-busy="true">
      <div className="page-loading-head">
        <span className="skeleton skeleton--eyebrow" />
        <span className="skeleton skeleton--title" />
      </div>
      <div className="skeleton skeleton--hero" />
      <div className="skeleton skeleton--row" />
      <div className="skeleton skeleton--row skeleton--short" />
      <span className="visually-hidden">正在加载</span>
    </div>
  );
}
