import { Link } from '@tanstack/react-router';
import { ArrowLeft, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function NotFoundPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-app-background px-4 py-10 text-foreground">
      <div className="relative mx-auto flex min-h-screen w-full max-w-120 flex-col items-center justify-center">
        <Card className="w-full">
          <CardContent className="space-y-6 p-8 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-md bg-surface-elevated text-muted-foreground">
              <Compass className="size-5" />
            </div>

            <div className="space-y-2">
              <div className="font-mono text-xs text-faint">404</div>
              <h1 className="t-h1 text-foreground">Page not found</h1>
            </div>

            <div className="flex items-center justify-center">
              <Button asChild>
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  Back to dashboard
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
