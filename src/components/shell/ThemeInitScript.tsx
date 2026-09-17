import Script from "next/script";

/**
 * Theme FOUC guard: runs before hydration so `data-theme` matches localStorage
 * before the first paint.
 * @see next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
 * @see next/dist/docs/01-app/03-api-reference/02-components/script.md
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem("chondro.theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export function ThemeInitScript() {
  return (
    <Script
      id="chondro-theme-init"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: THEME_INIT }}
    />
  );
}
