import { useSelector } from 'react-redux';
import { IRootState } from '../../store';

const Footer = () => {
    const isDarkMode = useSelector((state: IRootState) => state.themeConfig.isDarkMode);
    return (
      <div className="app-footer mt-auto flex items-center justify-center gap-1.5 p-6 pt-0 text-center">
    <img
        src={
            isDarkMode
                ? '/assets/images/siiv-dark-theme.png'
                : '/assets/images/siiv-light-theme.png'
        }
        alt="SIIV"
        className="h-6 w-auto"
    />

    <span className="whitespace-nowrap text-sm font-medium text-gray-600 dark:text-gray-400">
        © {new Date().getFullYear()} SIIV Group
    </span>
</div>
    );
};

export default Footer;
