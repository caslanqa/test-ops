import type { CSSProperties, ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { ThemeSwitcher } from './ThemeSwitcher';

// Giriş ve kayıt ekranlarındaki örnek şerit: gerçek veri değil, ürünün ne
// gösterdiğini anlatan dekoratif bir run (bu yüzden ekran okuyuculardan gizlenir).
const DEMO_RUN = 'PPPPPFPPPPBPPPPPPPFPPPPSPPPPPPPPFPPPPUUUUUUUUUUU'
  .split('')
  .map((ch) => ({ P: 'passed', F: 'failed', B: 'blocked', S: 'skipped', U: 'untested' })[ch] ?? 'untested');

/** Oturum açılmamış ekranların ortak iskeleti: solda ürün vitrini, sağda form. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      {/* Yalnızca örnek şerit dekoratiftir ve gizlenir; marka ve slogan okunur kalır. */}
      <section className="login-showcase" aria-label="TestOps">
        <BrandMark />
        <div className="login-ribbon" aria-hidden="true">
          <div className="ribbon ribbon--hero ribbon--cells">
            {DEMO_RUN.map((status, i) => (
              <span
                key={i}
                className={`ribbon-cell status-bg--${status}`}
                style={{ '--i': i } as CSSProperties}
              />
            ))}
          </div>
          <p className="login-ribbon-caption">Each cell is a test case; its color is that case's latest result.</p>
        </div>
        <p className="login-tagline">Manual tests and CI results in the same run, on the same ribbon.</p>
      </section>
      <main className="login-panel">
        <div className="login-theme">
          <ThemeSwitcher />
        </div>
        {children}
      </main>
    </div>
  );
}
