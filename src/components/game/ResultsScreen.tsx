import { Trophy, Skull, Ban, Home, RotateCcw } from "lucide-react";

interface Participant {
  id: string;
  user_id: string;
  role: string | null;
  status: string;
  captures_made: number;
  survival_seconds: number | null;
  profiles?: { username: string } | null;
}

interface MatchLike {
  status: string;
  winner: string | null;
  code: string;
}

function fmtSurvival(sec: number | null | undefined): string {
  if (sec == null) return "--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function ResultsScreen({
  match,
  participants,
  myUserId,
  myRole,
  onRematch,
  onExit,
  rematchLoading,
}: {
  match: MatchLike;
  participants: Participant[];
  myUserId: string;
  myRole: string | null;
  onRematch: () => void;
  onExit: () => void;
  rematchLoading: boolean;
}) {
  const winner = match.winner;
  const aborted = match.status === "aborted";
  const iWon =
    !aborted &&
    winner != null &&
    ((winner === "hunters" && myRole === "hunter") || (winner === "shadows" && myRole === "shadow"));

  const headline = aborted
    ? "Match Aborted"
    : winner === "none"
    ? "Match Ended"
    : iWon
    ? "VICTORY"
    : "DEFEAT";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 max-w-lg mx-auto flex flex-col">
      <div className="my-auto space-y-5">
        <div className="text-center space-y-2">
          {aborted ? (
            <Ban className="w-14 h-14 text-zinc-500 mx-auto" />
          ) : iWon ? (
            <Trophy className="w-14 h-14 text-emerald-400 mx-auto" />
          ) : (
            <Skull className="w-14 h-14 text-red-500 mx-auto" />
          )}
          <h1
            className={`text-3xl font-black tracking-widest uppercase ${
              aborted ? "text-zinc-400" : iWon ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {headline}
          </h1>
          <p className="text-xs text-zinc-400">
            {aborted
              ? "The match was stopped by the host."
              : winner === "hunters"
              ? "The Hunters caught every Shadow."
              : winner === "shadows"
              ? "The Shadows survived until the timer ran out."
              : "No side secured a win."}
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 px-4 pt-3 pb-2">
            Match Report
          </h3>
          <div className="divide-y divide-zinc-800/70">
            {participants.map((p) => {
              const isMe = p.user_id === myUserId;
              return (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-200 truncate">
                      {p.profiles?.username || "Operative"}
                      {isMe && <span className="text-emerald-400"> (you)</span>}
                    </div>
                    <div className="text-[10px] text-zinc-500 uppercase">
                      {p.role || "spectator"} · {p.status}
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-xs font-bold text-orange-400">
                      {p.captures_made} {p.role === "hunter" ? "captures" : ""}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      survived {fmtSurvival(p.survival_seconds)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 pb-4">
          <button
            onClick={onRematch}
            disabled={rematchLoading}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-black tracking-wider uppercase rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            <RotateCcw className="w-4 h-4" />
            {rematchLoading ? "Creating room..." : "Rematch — Same Settings"}
          </button>
          <button
            onClick={onExit}
            className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4" /> Back to Base
          </button>
        </div>
      </div>
    </div>
  );
}
