import React, { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, Play, SkipForward, Rewind, ShoppingCart, DollarSign } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Mock CSV parsing function
const parseCSV = (csvText) => {
  const lines = csvText.split('\n').filter(line => line);
  const headers = ['date', 'open', 'high', 'low', 'close']; // Assume format
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((obj, header, index) => {
      obj[header] = index === 0 ? new Date(values[index]).getTime() : parseFloat(values[index]);
      return obj;
    }, {});
  }).filter(d => !isNaN(d.close));
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="p-2 bg-slate-800 border border-slate-700 rounded-md text-sm">
        <p className="text-slate-300">{new Date(label).toLocaleString()}</p>
        <p className="text-blue-400">O: {data.open}</p>
        <p className="text-green-400">H: {data.high}</p>
        <p className="text-red-400">L: {data.low}</p>
        <p className="text-white">C: {data.close}</p>
      </div>
    );
  }
  return null;
};

export default function BacktesterPage() {
  const [data, setData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simulatedTrades, setSimulatedTrades] = useState([]);
  const [openTrade, setOpenTrade] = useState(null);

  const intervalRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const parsedData = parseCSV(e.target.result);
        setData(parsedData);
        setCurrentIndex(50);
      };
      reader.readAsText(file);
    }
  };

  const handleNext = () => {
    setCurrentIndex(prev => Math.min(prev + 1, data.length - 1));
  };

  const handleReset = () => {
    setCurrentIndex(50);
    setIsPlaying(false);
    setSimulatedTrades([]);
    setOpenTrade(null);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const togglePlay = () => {
    if (isPlaying) {
      clearInterval(intervalRef.current);
    } else {
      intervalRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= data.length - 1) {
            clearInterval(intervalRef.current);
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 200);
    }
    setIsPlaying(!isPlaying);
  };

  const handleTradeAction = (direction) => {
      const currentPrice = data[currentIndex].close;
      if (openTrade) {
        const pnl = (currentPrice - openTrade.entryPrice) * (openTrade.direction === 'long' ? 1 : -1);
        setSimulatedTrades([...simulatedTrades, { ...openTrade, exitPrice: currentPrice, pnl }]);
        setOpenTrade(null);
      } else {
        setOpenTrade({ entryPrice: currentPrice, direction, index: currentIndex });
      }
  };

  const displayedData = data.slice(0, currentIndex + 1);
  const totalPnl = simulatedTrades.reduce((sum, trade) => sum + trade.pnl, 0);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Strategy Backtester</h1>
          <p className="text-slate-400">Replay market data to test your strategies. Upload a CSV with format: Date,Open,High,Low,Close</p>
        </div>

        <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle className="text-white">Replay Mode</CardTitle>
                    <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    <Button onClick={() => fileInputRef.current.click()}><Upload className="w-4 h-4 mr-2" /> Upload CSV</Button>
                </div>
            </CardHeader>
            <CardContent>
              {data.length > 0 ? (
                <>
                <div className="h-[400px] w-full">
                    <ResponsiveContainer>
                      <AreaChart data={displayedData}>
                        <defs>
                          <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3"/>
                        <XAxis dataKey="date" tickFormatter={(time) => new Date(time).toLocaleDateString()} stroke="#94A3B8" />
                        <YAxis stroke="#94A3B8" domain={['auto', 'auto']} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="close" stroke="#3B82F6" fillOpacity={1} fill="url(#colorClose)" />
                      </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex justify-center items-center gap-4 mt-6 p-4 bg-slate-800 rounded-md">
                    <Button onClick={handleReset} variant="outline"><Rewind className="w-4 h-4 mr-2"/>Reset</Button>
                    <Button onClick={togglePlay} className="w-24">{isPlaying ? 'Pause' : 'Play'}<Play className="w-4 h-4 ml-2"/></Button>
                    <Button onClick={handleNext} variant="outline">Next Candle<SkipForward className="w-4 h-4 ml-2"/></Button>
                    <Button onClick={() => handleTradeAction('long')} variant="secondary" className="bg-green-600 hover:bg-green-700 ml-8">{openTrade?.direction === 'long' ? 'Close' : 'Buy'}</Button>
                    <Button onClick={() => handleTradeAction('short')} variant="secondary" className="bg-red-600 hover:bg-red-700">{openTrade?.direction === 'short' ? 'Close' : 'Sell'}</Button>
                </div>
                </>
              ) : (
                <div className="h-[400px] flex items-center justify-center text-slate-500">Upload data to begin backtest.</div>
              )}
            </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white">Backtest Results</CardTitle></CardHeader>
            <CardContent>
                <div className="flex gap-8">
                    <div className="text-center">
                        <p className="text-slate-400">Total Trades</p>
                        <p className="text-2xl font-bold">{simulatedTrades.length}</p>
                    </div>
                    <div className="text-center">
                        <p className="text-slate-400">Net P&L (points)</p>
                        <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>{totalPnl.toFixed(4)}</p>
                    </div>
                </div>
                <div className="mt-4">
                  <h4 className="font-semibold text-slate-300">Trade Log:</h4>
                  <ul className="text-xs text-slate-400 space-y-1 mt-2">
                    {simulatedTrades.map((t, i) => (
                      <li key={i}>
                        Trade {i+1}: {t.direction} @ {t.entryPrice.toFixed(4)} &rarr; {t.exitPrice.toFixed(4)}. P&L:
                        <span className={t.pnl >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {t.pnl.toFixed(4)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
            </CardContent>
        </Card>

      </div>
    </div>
  );
}
