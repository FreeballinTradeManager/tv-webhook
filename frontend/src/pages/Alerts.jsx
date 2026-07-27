import React, { useState, useEffect } from "react";
import { Alert } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newAlert, setNewAlert] = useState({ symbol: '', alert_type: 'price', target_price: '', message: '' });

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    const data = await Alert.list("-created_date");
    setAlerts(data);
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    await Alert.create(newAlert);
    setNewAlert({ symbol: '', alert_type: 'price', target_price: '', message: '' });
    loadAlerts();
  };

  const handleDelete = async (id) => {
    await Alert.delete(id);
    loadAlerts();
  };

  const toggleActive = async (alert) => {
    await Alert.update(alert.id, { is_active: !alert.is_active });
    loadAlerts();
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white">Active Alerts</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-slate-900">
                    <TableHead className="text-slate-300">Symbol</TableHead>
                    <TableHead className="text-slate-300">Type</TableHead>
                    <TableHead className="text-slate-300">Target</TableHead>
                    <TableHead className="text-slate-300">Status</TableHead>
                    <TableHead className="text-slate-300">Active</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map(alert => (
                    <TableRow key={alert.id} className="border-slate-800">
                      <TableCell className="font-medium text-white">{alert.symbol}</TableCell>
                      <TableCell className="text-slate-400 capitalize">{alert.alert_type.replace('_', ' ')}</TableCell>
                      <TableCell className="text-slate-400">{alert.target_price}</TableCell>
                      <TableCell><Badge variant={alert.is_triggered ? "destructive" : "secondary"}>{alert.is_triggered ? 'Triggered' : 'Pending'}</Badge></TableCell>
                      <TableCell><Switch checked={alert.is_active} onCheckedChange={() => toggleActive(alert)} /></TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => handleDelete(alert.id)}><Trash2 className="w-4 h-4 text-red-500"/></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
               <p className="text-xs text-slate-500 mt-4">* Note: Real-time alert triggering requires backend integration and is not functional in this demo.</p>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white">Create New Alert</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="symbol" className="text-slate-300">Symbol</Label>
                  <Input id="symbol" value={newAlert.symbol} onChange={(e) => setNewAlert({...newAlert, symbol: e.target.value})} placeholder="e.g., EURUSD" className="bg-slate-800 border-slate-700"/>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alert_type" className="text-slate-300">Alert Type</Label>
                  <Select value={newAlert.alert_type} onValueChange={(val) => setNewAlert({...newAlert, alert_type: val})}>
                    <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="price">Price Level</SelectItem>
                      <SelectItem value="breakout">Breakout</SelectItem>
                      <SelectItem value="daily_level">Daily Level</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="target_price" className="text-slate-300">Target Price</Label>
                  <Input id="target_price" type="number" step="any" value={newAlert.target_price} onChange={(e) => setNewAlert({...newAlert, target_price: e.target.value})} placeholder="1.23456" className="bg-slate-800 border-slate-700"/>
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4 mr-2"/>Add Alert</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
