import { useEffect, useState } from 'react';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import AppLayout from './AppLayout';
import { PreferencesProvider } from './PreferencesProvider';

export default function App() {
  const [router, setRouter] = useState<ReturnType<
    typeof createBrowserRouter
  > | null>(null);
  useEffect(() => {
    const instance = createBrowserRouter([
      {
        path: '*',
        element: (
          <PreferencesProvider>
            <AppLayout />
          </PreferencesProvider>
        ),
      },
    ]);
    setRouter(instance);
    return () => instance.dispose();
  }, []);
  return router ? <RouterProvider router={router} /> : null;
}
