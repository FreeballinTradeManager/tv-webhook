import React, { useState, useEffect } from "react";
import { Account } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function AccountForm({ account, onSave, onCancel }) {
  const [formData, setFormData] = useState(account || {
    name: "",
    broker_name: "",
    account_number: "",
    account_type: "prop_firm",
    starting_balance: "",
    current_balance: "",
    currency: "USD",
    daily_max_loss: "",
    total_max_loss: "",
    leverage: 100,
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {Object.entries(formData).map(([key, value]) => {
          if (key === 'id' || key.includes('_date') || key === 'created_by' || key === 'is_active') return null;

          if (key === 'account_type') {
            return (
              <div key={key} className="space-y-2 col-span-1">
                <Label htmlFor={key} className="text-slate-300">Account Type</Label>
                <Select value={value} onValueChange={(val) => handleChange(key, val)}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600 text-white">
                    <SelectItem value="prop_firm">Prop Firm</SelectItem>
                    <SelectItem value="funded">Funded</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="demo">Demo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          }

          if (key === 'currency') {
            return (
              <div key={key} className="space-y-2 col-span-1">
                <Label htmlFor={key} className="text-slate-300">Currency</Label>
                <Select value={value} onValueChange={(val) => handleChange(key, val)}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600 text-white">
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )
          }

          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={key} className="text-slate-300 capitalize">{key.replace(/_/g, ' ')}</Label>
              <Input
                id={key}
                type={typeof value === 'number' ? 'number' : 'text'}
                value={value}
                onChange={(e) => handleChange(key, e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
                required={['name', 'starting_balance', 'current_balance'].includes(key)}
              />
            </div>
          )
        })}
      </div>
      <DialogFooter className="pt-4">
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit">Save Account</Button>
      </DialogFooter>
    </form>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    const data = await Account.list("-created_date");
    setAccounts(data);
    setLoading(false);
  };

  const handleSave = async (accountData) => {
    if (editingAccount) {
      await Account.update(editingAccount.id, accountData);
    } else {
      await Account.create(accountData);
    }
    setEditingAccount(null);
    setIsFormOpen(false);
    loadAccounts();
  };

  const handleDelete = async (accountId) => {
    if (window.confirm("Are you sure you want to delete this account and all its trades?")) {
      // NOTE: Deleting associated trades would require backend logic.
      // For now, we just delete the account.
      await Account.delete(accountId);
      loadAccounts();
    }
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-white">Account Manager</h1>
            <p className="text-slate-400">Manage all your trading accounts in one place.</p>
          </div>
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditingAccount(null)} className="bg-blue-600 hover:bg-blue-700 text-white"><Plus className="w-4 h-4 mr-2" />Add Account</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[625px] bg-slate-800 border-slate-700 text-white">
              <DialogHeader>
                <DialogTitle>{editingAccount ? "Edit" : "Add"} Account</DialogTitle>
              </DialogHeader>
              <AccountForm
                account={editingAccount}
                onSave={handleSave}
                onCancel={() => { setIsFormOpen(false); setEditingAccount(null); }}
              />
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full bg-slate-800" />)}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {accounts.map(acc => (
              <Card key={acc.id} className="bg-slate-900 border-slate-800 flex flex-col justify-between">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-white">{acc.name}</CardTitle>
                    <Badge variant="outline" className="capitalize bg-blue-500/10 text-blue-400 border-blue-500/30">{acc.account_type.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-sm text-slate-400">{acc.broker_name}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-slate-300"><span>Current Balance</span> <span className="font-bold text-white">${acc.current_balance?.toLocaleString()}</span></div>
                  <div className="flex justify-between text-slate-300"><span>Starting Balance</span> <span className="font-mono">${acc.starting_balance?.toLocaleString()}</span></div>
                   <div className="flex justify-between text-slate-300"><span>P&L</span> <span className={(acc.current_balance - acc.starting_balance) >= 0 ? 'text-green-500' : 'text-red-500'}>${(acc.current_balance - acc.starting_balance).toLocaleString()}</span></div>
                </CardContent>
                <div className="p-4 flex justify-end gap-2 border-t border-slate-800">
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(acc.id)}>
                    <Trash2 className="w-4 h-4 text-red-500"/>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => { setEditingAccount(acc); setIsFormOpen(true); }}>
                    <Edit className="w-4 h-4 text-slate-400"/>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
