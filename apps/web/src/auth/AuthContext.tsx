import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, getToken, setToken } from '../api/client';
import { clearProjectInfoCache } from '../lib/projectInfo';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
}

interface SessionResponse {
  accessToken: string;
  user: CurrentUser;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, displayName: string, password: string) => Promise<void>;
  /** Profil güncellemesinden sonra sidebar'daki adı tazeler. */
  updateUser: (user: CurrentUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  // Token yoksa oturum kontrolü gerekmez; başlangıç durumu doğrudan "yüklendi"dir.
  const [loading, setLoading] = useState(() => getToken() !== null);

  useEffect(() => {
    if (!getToken()) return;
    api
      .get<CurrentUser>('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  function startSession(session: SessionResponse) {
    clearProjectInfoCache();
    setToken(session.accessToken);
    setUser(session.user);
  }

  async function login(email: string, password: string) {
    startSession(await api.post<SessionResponse>('/auth/login', { email, password }));
  }

  async function register(email: string, displayName: string, password: string) {
    startSession(
      await api.post<SessionResponse>('/auth/register', { email, displayName, password }),
    );
  }

  function logout() {
    clearProjectInfoCache();
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, updateUser: setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook bileşenle aynı dosyada: sağlayıcı ve tüketici birlikte değişir.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
