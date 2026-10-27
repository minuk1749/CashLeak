// 홈 화면 아이콘: 동전에서 물방울이 새는 모양
export function AppIcon({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0e7c72' }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 64 64">
        <circle cx="28" cy="26" r="20" fill="#ffffff" />
        <circle cx="28" cy="26" r="13" fill="none" stroke="#0e7c72" strokeWidth="4" />
        <path d="M48 40 C48 40 56 50 56 54 a8 8 0 0 1-16 0 c0-4 8-14 8-14z" fill="#9ff0e4" />
      </svg>
    </div>
  );
}
