import { Link } from "@tanstack/react-router";

export const ProjectSubpageHeader = ({
  projectId,
  projectName,
  sectionLabel,
  title,
  description,
}: {
  projectId: string;
  projectName: string;
  sectionLabel: string;
  title: string;
  description: string;
}) => (
  <div className="flex flex-col gap-3">
    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
      <Link to="/projects" className="hover:text-foreground transition-colors">
        Projects
      </Link>
      <span>/</span>
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="hover:text-foreground transition-colors"
      >
        {projectName}
      </Link>
      <span>/</span>
      <span className="text-foreground">{sectionLabel}</span>
    </div>
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground mt-1">{description}</p>
    </div>
  </div>
);
