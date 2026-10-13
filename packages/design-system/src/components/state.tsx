import { Loader2 } from "../icons";

export const LoadingState = ({ label = "Loading" }: { label?: string }) => (
  <div className="flex items-center gap-2 text-muted-foreground text-sm">
    <Loader2 className="h-4 w-4 animate-spin" />
    <span>{label}</span>
  </div>
);

export const ErrorState = ({
  title = "Something went wrong",
  message,
}: {
  title?: string;
  message?: string;
}) => (
  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
    <p className="font-medium text-destructive">{title}</p>
    {message ? <p className="mt-1 text-muted-foreground">{message}</p> : null}
  </div>
);
