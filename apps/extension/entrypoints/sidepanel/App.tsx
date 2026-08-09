import { APP_NAME } from '@jobibi/shared';

function App() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 bg-white p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">{APP_NAME}</h1>
      <p className="text-sm text-slate-500">Hello, side panel.</p>
    </div>
  );
}

export default App;
