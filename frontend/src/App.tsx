import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Layout } from 'antd';
import RaceListPage from './pages/RaceListPage';
import RaceDetailPage from './pages/RaceDetailPage';
import StrategyPage from './pages/StrategyPage';
import ProfitPage from './pages/ProfitPage';

const { Header, Content } = Layout;

export default function App() {
  return (
    <Layout style={{ minHeight: '100vh', background: '#fff' }}>
      <Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #e8e8e8',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          height: 48,
          gap: 16,
        }}
      >
        <a href="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#333', letterSpacing: 1 }}>
            BoatEV
          </span>
        </a>
        <NavLink to="/" label="レース" />
        <NavLink to="/strategy" label="作戦" />
        <NavLink to="/profit" label="収支" />
      </Header>
      <Content style={{ padding: '16px 24px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Routes>
          <Route path="/" element={<RaceListPage />} />
          <Route path="/race/:id" element={<RaceDetailPage />} />
          <Route path="/strategy" element={<StrategyPage />} />
          <Route path="/profit" element={<ProfitPage />} />
        </Routes>
      </Content>
    </Layout>
  );
}

function NavLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <span
      onClick={() => navigate(to)}
      style={{
        fontSize: 13,
        color: isActive ? '#333' : '#999',
        fontWeight: isActive ? 600 : 400,
        cursor: 'pointer',
        borderBottom: isActive ? '2px solid #52c41a' : 'none',
        paddingBottom: 2,
      }}
    >
      {label}
    </span>
  );
}
