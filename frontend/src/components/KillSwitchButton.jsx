import { useEffect, useState } from 'react';
import { KillSwitch } from '@/entities/all';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, PowerOff, ShieldCheck } from 'lucide-react';
import { notify } from '@/lib/notify';
import { audit, AUDIT_EVENTS } from '@/lib/audit_log';

// Task #43 — global kill switch button. Sits in Dashboard header.
// When ON — rejects every entry across every account.
// When OFF — trading resumes. Flatten-all option closes all open positions.
export default function KillSwitchButton() {
  const [status, setStatus] = useState({ on: false });
  const [confirmOn, setConfirmOn] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [reason, setReason] = useState('emergency');
  const [flattenAll, setFlattenAll] = useState(true);

  const load = async () => {
    try { setStatus(await KillSwitch.status()); }
    catch (e) { console.warn('kill-switch status:', e); }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const engage = async () => {
    try {
      const res = await KillSwitch.set(true, reason || 'emergency', flattenAll);
      setStatus(res);
      setConfirmOn(false);
      const flat = res.flattened;
      audit(AUDIT_EVENTS.KILL_SWITCH_FIRE, { reason: reason || 'emergency', flattenAll, flattened: flat });
      notify('emergency_close', {
        title: 'Kill Switch ENGAGED',
        body: flat?.positions_flattened
          ? `Flattened ${flat.positions_flattened} positions across ${flat.accounts_touched} accounts. Reason: ${reason || 'emergency'}.`
          : `Reason: ${reason || 'emergency'}. New entries blocked across every account.`,
      });
      if (flat?.positions_flattened) {
        alert(`🛑 Kill Switch ENGAGED\n\nFlattened ${flat.positions_flattened} positions across ${flat.accounts_touched} accounts.`);
      }
    } catch (e) {
      alert(`Failed to engage kill switch: ${e.message}`);
    }
  };

  const release = async () => {
    try {
      const res = await KillSwitch.set(false);
      setStatus(res);
      setConfirmOff(false);
      audit(AUDIT_EVENTS.KILL_SWITCH_RELEASE, {});
    } catch (e) {
      alert(`Failed to release kill switch: ${e.message}`);
    }
  };

  if (status.on) {
    return (
      <>
        <Button
          onClick={() => setConfirmOff(true)}
          className="bg-red-600 hover:bg-red-700 text-white font-bold border-2 border-red-400 shadow-lg shadow-red-500/50 animate-pulse"
        >
          <PowerOff className="w-4 h-4 mr-2"/>
          🛑 KILL SWITCH ENGAGED — click to release
        </Button>
        <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
          <DialogContent className="bg-slate-800 border-slate-700 text-white">
            <DialogHeader>
              <DialogTitle className="text-green-400 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5"/>Release Kill Switch?
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-slate-300">This will allow entries to fire again across all accounts.</p>
              {status.triggered_at && (
                <p className="text-xs text-slate-500">
                  Was engaged at {new Date(status.triggered_at).toLocaleString()}
                  {status.reason && ` — reason: "${status.reason}"`}
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={release} className="bg-green-600 hover:bg-green-700">
                Release — resume trading
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Button
        onClick={() => setConfirmOn(true)}
        variant="outline"
        className="bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300 font-semibold"
      >
        <AlertTriangle className="w-4 h-4 mr-2"/>
        Kill Switch
      </Button>
      <Dialog open={confirmOn} onOpenChange={setConfirmOn}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5"/>Engage Kill Switch?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-slate-300">This will:</p>
            <ul className="text-sm text-slate-400 space-y-1 list-disc list-inside pl-2">
              <li>Immediately block ALL entries across every account + strategy + group</li>
              <li>Optionally FLATTEN all currently open positions</li>
              <li>Persist until you manually release it</li>
            </ul>
            <div className="space-y-2 pt-2">
              <Label className="text-slate-300">Reason (audit log)</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)}
                     placeholder="e.g. 'weird price action', 'news event', 'testing'"
                     className="bg-slate-700 border-slate-600 text-white"/>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input type="checkbox" id="flatten" checked={flattenAll}
                     onChange={e => setFlattenAll(e.target.checked)}
                     className="accent-red-500"/>
              <Label htmlFor="flatten" className="text-slate-300 cursor-pointer text-sm">
                Also FLATTEN all currently open positions (recommended)
              </Label>
            </div>
            <div className="text-xs text-slate-400 bg-slate-900/60 border border-slate-700 rounded-md px-2.5 py-2 leading-relaxed">
              <span className="text-white font-semibold">Observe-mode accounts</span> (PMT / TradersPost) get locked so we
              reject any incoming signals into your journal — but TradeCore can't flatten their live broker positions.
              For those, also hit flatten in your primary broker's UI.
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={engage}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold border-2 border-red-400">
              🛑 ENGAGE KILL SWITCH
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
