export function Avatar({ profile, size = 32 }: { profile: { displayName: string; avatarUrl: string | null; avatarColor: string }; size?: number }) {
  if (profile.avatarUrl) {
    return <img src={profile.avatarUrl} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="grid place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: profile.avatarColor, fontSize: size * 0.42 }}
    >
      {profile.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}
