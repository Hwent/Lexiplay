import { useTranslation } from './i18n';
import Icon from './Icon';
export default function SelectionControl({label,checked,disabled,onChange,children}:{label:string;checked:boolean;disabled?:boolean;onChange:(checked:boolean)=>void;children?:React.ReactNode}) {
  const t = useTranslation();
  return <label className="selection-control"><input type="checkbox" aria-label={t(label)} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><span className="selection-control-mark" aria-hidden="true"><Icon name={checked?'check':'plus'}/></span>{children&&<span>{children}</span>}</label>;
}
